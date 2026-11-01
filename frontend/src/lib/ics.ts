import { newId, type Application } from './store'

/* Calendar entries come from applications: interviews, follow-ups and apply-by dates of drafts. */

export type EntryKind = 'interview' | 'followup' | 'deadline'

export interface CalEntry {
  uid: string
  appId: string
  itemId: string
  kind: EntryKind
  date: string
  time: string
  duration_min: number
  title: string
  notes: string
  company: string
  role: string
  done: boolean
}

export const KIND_LABEL: Record<EntryKind, string> = { interview: 'Interview', followup: 'Follow-up', deadline: 'Apply by' }

const label = (a: Application) => [a.role, a.company].filter(Boolean).join(' at ') || 'Untitled application'

export function calendarEntries(apps: Application[]): CalEntry[] {
  const out: CalEntry[] = []
  for (const a of apps) {
    const base = { appId: a.id, company: a.company, role: a.role }
    for (const i of a.interviews ?? []) {
      if (!i.date) continue
      out.push({ ...base, uid: `${a.id}-i-${i.id}`, itemId: i.id, kind: 'interview', date: i.date, time: i.time || '', duration_min: i.duration_min || 60,
        title: `${i.title || 'Interview'}: ${label(a)}`, notes: i.notes || '', done: false })
    }
    for (const f of a.followups ?? []) {
      if (!f.date) continue
      out.push({ ...base, uid: `${a.id}-f-${f.id}`, itemId: f.id, kind: 'followup', date: f.date, time: '', duration_min: 0,
        title: `Follow up: ${label(a)}`, notes: f.note || '', done: !!f.done })
    }
    if (a.deadline && String(a.status) === 'Draft') {
      out.push({ ...base, uid: `${a.id}-d`, itemId: '', kind: 'deadline', date: a.deadline, time: '', duration_min: 0,
        title: `Apply by: ${label(a)}`, notes: '', done: false })
    }
  }
  return out.sort((x, y) => (x.date + (x.time || '00:00')).localeCompare(y.date + (y.time || '00:00')))
}

export const appUrl = (appId: string) => `${location.origin}${location.pathname}#application?id=${encodeURIComponent(appId)}`

/* ---------- RFC 5545 ---------- */

/** TEXT escaping: backslash, semicolon, comma and newlines. */
export const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Folds a content line at 75 octets (UTF-8), never splitting a character. Continuation lines start with a space. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = parts.length ? 74 : 75 // the leading space counts on continuation lines
    if (size + n > limit) {
      parts.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

/** Reverses escapeText. */
export const unescapeText = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

export interface IcsEvent {
  date: string // yyyy-mm-dd
  end: string // exclusive yyyy-mm-dd for all-day events, '' when absent
  summary: string
  description: string
}

/** VEVENTs of an .ics file as plain text (never interpreted). Dates come from the first 8 digits of DTSTART/DTEND. */
export function parseIcs(text: string, max = 2000): IcsEvent[] {
  const out: IcsEvent[] = []
  let ev: Record<string, string> | null = null
  const day = (v = '') => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '')
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') ev = {}
    else if (line === 'END:VEVENT' && ev) {
      const date = day(ev.DTSTART)
      if (date) out.push({ date, end: day(ev.DTEND), summary: unescapeText(ev.SUMMARY ?? '').trim(), description: unescapeText(ev.DESCRIPTION ?? '') })
      ev = null
      if (out.length >= max) break
    } else if (ev) {
      const i = line.indexOf(':')
      const name = line.slice(0, i).split(';')[0].toUpperCase()
      if (i > 0 && ['DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION'].includes(name) && !(name in ev)) ev[name] = line.slice(i + 1)
    }
  }
  return out
}

/* ---------- Dates and entry edits ---------- */

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s: string, n: number) => {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export const dayLabel = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  parseDay(s).toLocaleDateString(undefined, opts)
export type EntryDraft = { appId: string; kind: 'interview' | 'followup'; itemId: string; date: string; time: string; duration: number; title: string; notes: string }

/** Adds or replaces an interview or follow-up on an application. */
export function saveEntry(apps: Application[], d: EntryDraft): Application[] {
  return apps.map((a) => {
    if (a.id !== d.appId) return a
    const x = a
    if (d.kind === 'interview') {
      const item = { id: d.itemId || newId(), date: d.date, time: d.time, duration_min: d.duration || 60, title: d.title.trim() || 'Interview', notes: d.notes.trim() }
      const list = x.interviews ?? []
      return { ...x, interviews: d.itemId ? list.map((i) => (i.id === d.itemId ? item : i)) : [...list, item] } as Application
    }
    const prev = (x.followups ?? []).find((f) => f.id === d.itemId)
    const item = { id: d.itemId || newId(), date: d.date, note: d.notes.trim(), done: prev?.done ?? false }
    const list = x.followups ?? []
    return { ...x, followups: d.itemId ? list.map((f) => (f.id === d.itemId ? item : f)) : [...list, item] } as Application
  })
}

const compact = (date: string) => date.replace(/-/g, '')

/** Adds minutes to a local yyyy-mm-dd + HH:MM, returning yyyymmddThhmmss (floating local time). */
function localStamp(date: string, time: string, addMin = 0) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const t = new Date(y, m - 1, d, hh, mm + addMin)
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}T${pad(t.getHours())}${pad(t.getMinutes())}00`
}
function nextDay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d + 1)
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`
}

function eventLines(e: CalEntry, stamp: string): string[] {
  const timed = !!e.time
  const desc = [e.notes, `Open in Jivika: ${appUrl(e.appId)}`].filter(Boolean).join('\n')
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}@jivika`,
    `DTSTAMP:${stamp}`,
    timed ? `DTSTART:${localStamp(e.date, e.time)}` : `DTSTART;VALUE=DATE:${compact(e.date)}`,
    timed ? `DTEND:${localStamp(e.date, e.time, e.duration_min || 60)}` : `DTEND;VALUE=DATE:${nextDay(e.date)}`,
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(desc)}`,
    `URL:${appUrl(e.appId)}`,
    'END:VEVENT',
  ]
}

/** An all-day event that is not tied to an application, such as a holiday or a personal day off. */
export interface AllDayEvent {
  date: string
  title: string
  notes?: string
}

function allDayLines(e: AllDayEvent, stamp: string): string[] {
  const uid = `${compact(e.date)}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`
  return [
    'BEGIN:VEVENT',
    `UID:holiday-${uid}@jivika`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(e.date)}`,
    `DTEND;VALUE=DATE:${nextDay(e.date)}`,
    `SUMMARY:${escapeText(e.title)}`,
    ...(e.notes ? [`DESCRIPTION:${escapeText(e.notes)}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ]
}

export function buildIcs(entries: CalEntry[], now = new Date(), extra: AllDayEvent[] = []): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const events = [...entries.flatMap((e) => eventLines(e, stamp)), ...extra.flatMap((e) => allDayLines(e, stamp))]
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jivika//Job search calendar//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR']
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadIcs(entries: CalEntry[], fileName: string, extra: AllDayEvent[] = []) {
  const url = URL.createObjectURL(new Blob([buildIcs(entries, new Date(), extra)], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Google Calendar's public event template link. Opens a prefilled form; nothing is sent until the user saves it there. */
export function googleCalendarUrl(e: CalEntry): string {
  const dates = e.time
    ? `${localStamp(e.date, e.time)}/${localStamp(e.date, e.time, e.duration_min || 60)}`
    : `${compact(e.date)}/${nextDay(e.date)}`
  const qs = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: [e.notes, appUrl(e.appId)].filter(Boolean).join('\n\n') })
  return `https://calendar.google.com/calendar/render?${qs}`
}
