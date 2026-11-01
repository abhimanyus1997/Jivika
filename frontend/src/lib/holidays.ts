import { useEffect, useMemo, useState } from 'react'
import { request } from './api'
import { addDays, parseDay, parseIcs } from './ics'
import { newId, read, today, useProfile, useStored, write } from './store'

/* Public holidays (from /api/holidays, cached per country and year) plus the user's own days off. */

export type HolidayKind = 'public' | 'observance' | 'regional'
export interface Holiday {
  date: string
  name: string
  kind: HolidayKind
  region?: string
}

/** Same allow-list as jivika/holidays.py. */
export const COUNTRIES: [string, string][] = [
  ['ar', 'Argentina'], ['au', 'Australia'], ['at', 'Austria'], ['bh', 'Bahrain'], ['bd', 'Bangladesh'], ['be', 'Belgium'],
  ['br', 'Brazil'], ['bg', 'Bulgaria'], ['ca', 'Canada'], ['cl', 'Chile'], ['cn', 'China'], ['co', 'Colombia'],
  ['hr', 'Croatia'], ['cz', 'Czechia'], ['dk', 'Denmark'], ['eg', 'Egypt'], ['fi', 'Finland'], ['fr', 'France'],
  ['de', 'Germany'], ['gr', 'Greece'], ['hk', 'Hong Kong'], ['hu', 'Hungary'], ['in', 'India'], ['id', 'Indonesia'],
  ['ie', 'Ireland'], ['il', 'Israel'], ['it', 'Italy'], ['jp', 'Japan'], ['ke', 'Kenya'], ['kw', 'Kuwait'],
  ['lv', 'Latvia'], ['lt', 'Lithuania'], ['my', 'Malaysia'], ['mx', 'Mexico'], ['np', 'Nepal'], ['nl', 'Netherlands'],
  ['nz', 'New Zealand'], ['ng', 'Nigeria'], ['no', 'Norway'], ['om', 'Oman'], ['pk', 'Pakistan'], ['pe', 'Peru'],
  ['ph', 'Philippines'], ['pl', 'Poland'], ['pt', 'Portugal'], ['qa', 'Qatar'], ['ro', 'Romania'], ['ru', 'Russia'],
  ['sa', 'Saudi Arabia'], ['sg', 'Singapore'], ['sk', 'Slovakia'], ['za', 'South Africa'], ['kr', 'South Korea'], ['es', 'Spain'],
  ['lk', 'Sri Lanka'], ['se', 'Sweden'], ['ch', 'Switzerland'], ['tw', 'Taiwan'], ['th', 'Thailand'], ['tr', 'Turkey'],
  ['ua', 'Ukraine'], ['ae', 'United Arab Emirates'], ['gb', 'United Kingdom'], ['us', 'United States'], ['vn', 'Vietnam'],
]
const ALIASES: Record<string, string> = { usa: 'us', 'u.s.': 'us', uk: 'gb', england: 'gb', scotland: 'gb', uae: 'ae', dubai: 'ae', bharat: 'in' }

/** Country code guessed from a free-text location such as "Bengaluru, India"; India when nothing matches. */
export function countryFromLocation(location = ''): string {
  const words = location.toLowerCase().split(/[^a-z.]+/).filter(Boolean)
  const text = ` ${words.join(' ')} `
  const hit = COUNTRIES.find(([, name]) => text.includes(` ${name.toLowerCase()} `))
  return hit?.[0] ?? words.map((w) => ALIASES[w]).find(Boolean) ?? 'in'
}

export interface HolidaySettings {
  country: string // '' = from the profile
  public: boolean
  observance: boolean
  regional: boolean
  region: string // '' = all regions
  includeInExport: boolean
}
const DEFAULT_SETTINGS: HolidaySettings = { country: '', public: true, observance: false, regional: true, region: '', includeInExport: false }
export const useHolidaySettings = () => useStored<HolidaySettings>('holidaySettings', DEFAULT_SETTINGS)

export type DayOffKind = 'leave' | 'festival' | 'notice' | 'other'
export const DAY_OFF_LABEL: Record<DayOffKind, string> = { leave: 'Leave', festival: 'Local festival', notice: 'Notice period ends', other: 'Day off' }
export interface DayOff {
  id: string
  date: string
  end?: string // inclusive, for leave spanning several days
  kind: DayOffKind
  label: string
}
export const useDaysOff = () => useStored<DayOff[]>('daysOff', [])

/** Holidays read from .ics files the user imported, one list per file. */
export interface HolidayImport {
  id: string
  file: string
  items: Holiday[]
}
export const useHolidayImports = () => useStored<HolidayImport[]>('holidayImports', [])

/* ---------- Fetching and cache ---------- */

type Cache = Record<string, { at: number; items: Holiday[] }>
const CACHE_KEY = 'holidayCache'
const FRESH_MS = 7 * 864e5
const MAX_CACHED = 12 // country-years kept in localStorage
const failed = new Map<string, { at: number; message: string }>() // per session, so an unavailable feed is not retried on every render
const RETRY_MS = 5 * 60_000
const failedRecently = (key: string) => {
  const f = failed.get(key)
  return !!f && Date.now() - f.at < RETRY_MS
}

async function load(country: string, year: number) {
  const key = `${country}-${year}`
  try {
    const r = await request<{ holidays: Holiday[] }>(`/holidays?${new URLSearchParams({ country, year: String(year) })}`)
    const cache = read<Cache>(CACHE_KEY, {})
    cache[key] = { at: Date.now(), items: r.holidays }
    const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CACHED)
    write(CACHE_KEY, Object.fromEntries(keep))
  } catch (e) {
    failed.set(key, { at: Date.now(), message: e instanceof Error ? e.message : 'Holidays could not be loaded.' })
  }
}

/** Effective country: the chosen one, else guessed from the profile location. */
export function useHolidayCountry(): string {
  const [settings] = useHolidaySettings()
  const [profile] = useProfile()
  return settings.country || countryFromLocation(profile?.location)
}

/** Raw holidays for the effective country and the given years, fetched when missing or older than a week. */
export function useHolidays(years: number[]): { items: Holiday[]; error: string; loading: boolean } {
  const country = useHolidayCountry()
  const [cache] = useStored<Cache>(CACHE_KEY, {})
  const [, rerender] = useState(0) // failures live outside React state
  const yearKey = [...new Set(years)].sort().join(',')
  useEffect(() => {
    const todo = yearKey.split(',').map(Number).filter((y) => {
      const hit = read<Cache>(CACHE_KEY, {})[`${country}-${y}`]
      return !failedRecently(`${country}-${y}`) && (!hit || Date.now() - hit.at > FRESH_MS)
    })
    if (!todo.length) return
    Promise.all(todo.map((y) => load(country, y))).finally(() => rerender((n) => n + 1))
  }, [country, yearKey])
  const keys = useMemo(() => yearKey.split(',').map((y) => `${country}-${y}`), [country, yearKey])
  const items = useMemo(() => keys.flatMap((k) => cache[k]?.items ?? []), [cache, keys])
  const error = keys.every((k) => cache[k]) ? '' : (keys.map((k) => failed.get(k)?.message).find(Boolean) ?? '')
  return { items, error, loading: keys.some((k) => !cache[k] && !failed.has(k)) }
}

/** Region names from regional holidays, e.g. German states or Australian territories. */
export const regionsOf = (items: Holiday[]) =>
  [...new Set(items.flatMap((h) => (h.region ? h.region.split(/,\s*/) : [])))].filter(Boolean).sort((a, b) => a.localeCompare(b))

/** Years whose holidays a month view needs: the month's year, a neighbour when the grid spills over, and this year. */
export function calendarYears(month: string, now = today()): number[] {
  const y = Number(month.slice(0, 4))
  const m = month.slice(5, 7)
  const thisYear = Number(now.slice(0, 4))
  return [y, thisYear, ...(m === '12' ? [y + 1] : m === '01' ? [y - 1] : []), ...(now.slice(5, 7) === '12' ? [thisYear + 1] : [])]
}

/* ---------- Combined days ---------- */

export interface OffDay {
  name: string
  kind: HolidayKind | 'personal'
  /** True for days you are likely not working: public and regional holidays and personal days off, not observances. */
  off: boolean
}
export type OffMap = Map<string, OffDay[]>

function expand(d: DayOff): string[] {
  const out = [d.date]
  // ponytail: ranges capped at 62 days; longer leave can be split into several entries
  while (d.end && out.length < 62 && out[out.length - 1] < d.end) out.push(addDays(out[out.length - 1], 1))
  return out
}

/** Holidays shown with the current settings plus imported holidays and personal days off, by date. */
export function useOffDays(years: number[]): { off: OffMap; error: string; loading: boolean } {
  const [settings] = useHolidaySettings()
  const [daysOff] = useDaysOff()
  const [imports] = useHolidayImports()
  const { items, error, loading } = useHolidays(years)
  const off = useMemo(() => {
    const m: OffMap = new Map()
    const add = (date: string, o: OffDay) => {
      const list = m.get(date) ?? []
      if (!list.some((x) => x.name === o.name)) m.set(date, [...list, o])
    }
    for (const h of [...items, ...imports.flatMap((i) => i.items)]) {
      if (!settings[h.kind]) continue
      if (h.kind === 'regional' && settings.region && !h.region?.split(/,\s*/).includes(settings.region)) continue
      add(h.date, { name: h.name, kind: h.kind, off: h.kind !== 'observance' })
    }
    for (const d of daysOff) for (const day of expand(d)) add(day, { name: d.label || DAY_OFF_LABEL[d.kind], kind: 'personal', off: true })
    return m
  }, [items, imports, daysOff, settings])
  return { off, error, loading }
}

export const isWeekend = (date: string) => [0, 6].includes(parseDay(date).getDay())
export const offReason = (date: string, off: OffMap) => off.get(date)?.find((o) => o.off)?.name

/** The first day on or after `date` that is not a weekend, holiday or personal day off. */
export function nextWorkingDay(date: string, off: OffMap): string {
  let d = date
  for (let i = 0; i < 60 && (isWeekend(d) || offReason(d, off)); i++) d = addDays(d, 1)
  return d
}

/* ---------- Import of holiday .ics files ---------- */

const MAX_FILE = 2 * 1024 * 1024

/** Reads a holiday calendar (.ics), classifying Google's "Public holiday" / "Observance" descriptions. */
export async function importHolidayFile(file: File): Promise<HolidayImport> {
  if (file.size > MAX_FILE) throw new Error('The file is larger than 2 MB.')
  const events = parseIcs(await file.text())
  if (!events.length) throw new Error('No all-day events were found in this file.')
  const items: Holiday[] = []
  for (const e of events) {
    const first = e.description.split('\n')[0].trim()
    const region = /^(?:Public holiday|Observance) in (.+)$/.exec(first)?.[1]
    const kind: HolidayKind = region ? 'regional' : first.startsWith('Observance') ? 'observance' : 'public'
    for (let d = e.date, n = 0; d < (e.end || addDays(e.date, 1)) && n < 31; d = addDays(d, 1), n++) {
      items.push({ date: d, name: e.summary.slice(0, 200) || 'Holiday', kind, ...(region ? { region } : {}) })
    }
  }
  return { id: newId(), file: file.name.slice(0, 120), items: items.slice(0, 2000) }
}
