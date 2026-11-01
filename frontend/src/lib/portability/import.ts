import type { StructuredProfile } from '../api'
import {
  isKnownKey,
  migrateApplication,
  newId,
  normalizeStructured,
  read,
  SECTION_KEYS,
  syncProfileFromStructured,
  write,
  type Application,
  type SectionKey,
  type Status,
  type StoredResume,
} from '../store.ts'
import { autoMap, parseCsv, rowsToApplications, sniffDelimiter, type AppField } from './csv.ts'
import { decodeText, detectKind, MB, RESUME_FILE_LIMIT, TEXT_LIMIT, ZIP_LIMIT, type FileKind } from './detect.ts'
import { fromEuropassDoc, fromLegacyEuropassJson } from './europass.ts'
import { fromJsonResume } from './jsonresume.ts'
import { fromLinkedInExport, isLinkedInFile } from './linkedin-export.ts'
import { parseXmlSafe } from './xml.ts'
import { isZip, readZip } from './zip.ts'

/* Reading files into an import plan, merging with local data, and applying it. */

export const EXPORT_FORMAT_VERSION = 2
export const MAX_ENTRIES = 2000
/** Never imported, replaced or exported. */
export const SECRET_KEYS = ['apikey', 'keyVerified', 'importSnapshot']
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export type Policy = 'mine' | 'file' | 'both'

export interface IcsEvent {
  uid: string
  title: string
  date: string
  time: string
  duration_min: number
  notes: string
  location: string
  /** Application id found in the event (Jivika links), when any. */
  appId: string
  /** Interview or follow-up id from a Jivika UID, when any. */
  itemId: string
  kind: 'interview' | 'followup' | 'deadline'
}

export type ImportPlan =
  | { kind: 'data'; source: FileKind; data: Record<string, unknown>; skipped: string[]; version: number }
  | { kind: 'profile'; source: FileKind; profile: StructuredProfile | null; resume?: StoredResume }
  | { kind: 'applications'; source: FileKind; headers: string[]; rows: string[][]; mapping: Partial<Record<AppField, number>> }
  | { kind: 'events'; source: FileKind; events: IcsEvent[] }
  | { kind: 'resume-text'; source: FileKind; text: string }
  | { kind: 'resume-file'; source: FileKind; file: File }

/* ---------- Validation ---------- */

/** Throws when any object key at any depth is __proto__, constructor or prototype. */
export function assertSafeKeys(v: unknown, depth = 0): void {
  if (depth > 64) throw new Error('The file is nested too deeply.')
  if (Array.isArray(v)) return v.forEach((x) => assertSafeKeys(x, depth + 1))
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN.has(k)) throw new Error(`The file contains a disallowed key (${k}).`)
      assertSafeKeys((v as Record<string, unknown>)[k], depth + 1)
    }
  }
}

/** Version 1 files predate status migration; version 2 stores migrated applications and normalised profiles. */
export function migrateExport(data: Record<string, unknown>, version: number): Record<string, unknown> {
  const out = { ...data }
  if (version < 2) {
    if (Array.isArray(out.applications)) out.applications = (out.applications as Application[]).filter((a) => a && typeof a === 'object').map(migrateApplication)
    if (out.structuredProfile && typeof out.structuredProfile === 'object') out.structuredProfile = normalizeStructured(out.structuredProfile as StructuredProfile)
  }
  return out
}

/** Checks a parsed Jivika JSON export. Unknown entries are skipped and listed rather than rejected. */
export function validateJivika(raw: unknown): { data: Record<string, unknown>; skipped: string[]; version: number } {
  const f = raw as { app?: unknown; version?: unknown; data?: unknown } | null
  if (!f || typeof f !== 'object' || Array.isArray(f) || f.app !== 'jivika') throw new Error('This file is not a Jivika export.')
  if (typeof f.version !== 'number') throw new Error('The file has no version field, so it is not a Jivika export.')
  if (f.version > EXPORT_FORMAT_VERSION) throw new Error(`This export is from a newer version of Jivika (format ${f.version}). Update Jivika and try again.`)
  if (!f.data || typeof f.data !== 'object' || Array.isArray(f.data)) throw new Error('This Jivika file is a read-only listing. Import the full Jivika export instead.')
  assertSafeKeys(f.data)
  const data: Record<string, unknown> = {}
  const skipped: string[] = []
  for (const [k, v] of Object.entries(f.data as Record<string, unknown>)) {
    if (SECRET_KEYS.includes(k) || /apikey/i.test(k)) continue
    if (!isKnownKey(k)) {
      skipped.push(k)
      continue
    }
    if (Array.isArray(v) && v.length > MAX_ENTRIES) throw new Error(`"${k}" has more than ${MAX_ENTRIES} entries.`)
    data[k] = v
  }
  return { data: migrateExport(data, f.version), skipped, version: f.version }
}

/* ---------- iCalendar ---------- */

const unescapeIcs = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
const pad = (n: number) => String(n).padStart(2, '0')

function icsDate(value: string, params: string): { date: string; time: string } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' }
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
  }
  // ponytail: TZID times are read as local wall-clock time; convert with Intl if users import across time zones.
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` }
}

const durationMin = (s: string) => {
  const m = s.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/)
  return m ? (+(m[1] ?? 0) * 7 * 24 + +(m[2] ?? 0) * 24 + +(m[3] ?? 0)) * 60 + +(m[4] ?? 0) : 0
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: IcsEvent[] = []
  let cur: Record<string, { value: string; params: string }> | null = null
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) cur = {}
    else if (/^END:VEVENT$/i.test(line) && cur) {
      const start = cur.DTSTART && icsDate(cur.DTSTART.value, cur.DTSTART.params)
      if (start) {
        const end = cur.DTEND && icsDate(cur.DTEND.value, cur.DTEND.params)
        let duration = cur.DURATION ? durationMin(cur.DURATION.value) : 0
        if (!duration && end && start.time && end.time) duration = Math.round((new Date(`${end.date}T${end.time}`).getTime() - new Date(`${start.date}T${start.time}`).getTime()) / 60000)
        const uid = unescapeIcs(cur.UID?.value ?? '')
        const desc = unescapeIcs(cur.DESCRIPTION?.value ?? '')
        const url = cur.URL?.value ?? ''
        const appId = decodeURIComponent((url + ' ' + desc).match(/#application\?id=([^&\s]+)/)?.[1] ?? '')
        const own = uid.match(/-(i|f)-(.+)@jivika$/)
        const title = unescapeIcs(cur.SUMMARY?.value ?? '').trim()
        events.push({
          uid,
          title,
          date: start.date,
          time: start.time,
          duration_min: duration > 0 ? duration : start.time ? 60 : 0,
          notes: desc.replace(/\n?Open in Jivika: \S+/, '').trim(),
          location: unescapeIcs(cur.LOCATION?.value ?? ''),
          appId,
          itemId: own?.[2] ?? '',
          kind: own?.[1] === 'f' || /^follow up:/i.test(title) ? 'followup' : /-d@jivika$/.test(uid) || /^apply by:/i.test(title) ? 'deadline' : 'interview',
        })
        if (events.length > MAX_ENTRIES) throw new Error(`The calendar has more than ${MAX_ENTRIES} events.`)
      }
      cur = null
    } else if (cur) {
      const m = line.match(/^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/)
      if (m && !cur[m[1].toUpperCase()]) cur[m[1].toUpperCase()] = { params: m[2], value: m[3] }
    }
  }
  return events
}

/* ---------- Reading a file ---------- */

async function bytesOf(file: Blob) {
  return new Uint8Array(await file.arrayBuffer())
}

/** Reads a file into a plan. Throws a readable error for anything unsupported or over the limits. */
export async function readImportFile(file: File): Promise<ImportPlan> {
  if (file.size > ZIP_LIMIT) throw new Error(`The file is larger than ${ZIP_LIMIT / MB} MB.`)
  const bytes = await bytesOf(file)
  // Only ZIP bundles may exceed the text limit; checked before detectKind parses anything.
  if (!isZip(bytes) && bytes.length > TEXT_LIMIT) throw new Error(`The file is larger than ${TEXT_LIMIT / MB} MB.`)
  const source = detectKind(file.name, bytes)
  const textual = !['jivika-zip', 'linkedin-zip', 'resume-file'].includes(source)
  if (textual && bytes.length > TEXT_LIMIT) throw new Error(`The file is larger than ${TEXT_LIMIT / MB} MB.`)
  const text = () => decodeText(bytes)
  switch (source) {
    case 'jivika-json':
      return { kind: 'data', source, ...validateJivika(JSON.parse(text())) }
    case 'jivika-zip': {
      const [entry] = await readZip(bytes, (n) => n === 'jivika.json')
      if (!entry) throw new Error('The bundle has no jivika.json.')
      return { kind: 'data', source, ...validateJivika(JSON.parse(decodeText(entry.data))) }
    }
    case 'jsonresume': {
      const v = JSON.parse(text())
      assertSafeKeys(v)
      return { kind: 'profile', source, profile: fromJsonResume(v) }
    }
    case 'europass-json': {
      const v = JSON.parse(text())
      assertSafeKeys(v)
      return { kind: 'profile', source, profile: fromLegacyEuropassJson(v) }
    }
    case 'europass-xml':
      return { kind: 'profile', source, profile: fromEuropassDoc(parseXmlSafe(text())) }
    case 'linkedin-zip': {
      const entries = await readZip(bytes, isLinkedInFile)
      return { kind: 'profile', source, profile: fromLinkedInExport(Object.fromEntries(entries.map((e) => [e.name, decodeText(e.data)]))) }
    }
    case 'applications-csv': {
      const t = text()
      const rows = parseCsv(t, sniffDelimiter(t))
      if (rows.length - 1 > MAX_ENTRIES) throw new Error(`The spreadsheet has more than ${MAX_ENTRIES} rows.`)
      const headers = rows[0] ?? []
      return { kind: 'applications', source, headers, rows: rows.slice(1), mapping: autoMap(headers) }
    }
    case 'ics':
      return { kind: 'events', source, events: parseIcs(text()) }
    case 'text-resume':
      return { kind: 'resume-text', source, text: text().slice(0, 60000) }
    case 'resume-file':
      if (file.size > RESUME_FILE_LIMIT) throw new Error(`Resume files can be up to ${RESUME_FILE_LIMIT / MB} MB.`)
      return { kind: 'resume-file', source, file }
    default:
      throw new Error('Jivika could not recognise this file. Supported: Jivika exports, JSON Resume, Europass, LinkedIn data exports, CSV, .ics and resumes.')
  }
}

/* ---------- Merging ---------- */

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/**
 * Merges lists. On a conflict: 'mine' keeps the local item, 'file' takes the file's item (keeping the local id so
 * links survive), 'both' keeps the local item and adds the file's under a new id. New items come first.
 */
export function mergeList<T>(local: T[], incoming: T[], same: (a: T, b: T) => boolean, policy: Policy, renew: (t: T) => T = (t) => t): T[] {
  const next = [...local]
  const added: T[] = []
  for (const inc of incoming) {
    const i = next.findIndex((l) => same(l, inc))
    if (i < 0) added.push(inc)
    else if (policy === 'file') next[i] = keepId(next[i], inc)
    else if (policy === 'both') added.push(renew(inc))
  }
  return [...added, ...next]
}
function keepId<T>(local: T, inc: T): T {
  const id = (local as { id?: unknown })?.id
  return id !== undefined && inc && typeof inc === 'object' ? ({ ...inc, id } as T) : inc
}
const withNewId = <T>(t: T): T => (t && typeof t === 'object' && 'id' in (t as object) ? ({ ...t, id: newId() } as T) : t)

export const sameApplication = (a: Application, b: Application) => a.id === b.id || (!!norm(a.company + a.role) && norm(a.company) === norm(b.company) && norm(a.role) === norm(b.role))

const hasIds = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Merges one stored value. Applications match by id or company and role, other lists by id, objects by key. */
export function mergeStored(key: string, local: unknown, incoming: unknown, policy: Policy): unknown {
  if (local == null) return incoming
  if (key === 'applications' && Array.isArray(local) && Array.isArray(incoming))
    return mergeList((local as Application[]).map(migrateApplication), (incoming as Application[]).map(migrateApplication), sameApplication, policy, withNewId)
  if (key === 'structuredProfile' && isPlain(local) && isPlain(incoming)) return mergeProfile(local as unknown as StructuredProfile, incoming as unknown as StructuredProfile, policy)
  if (hasIds(local) && hasIds(incoming)) return mergeList(local, incoming, (a, b) => a.id === b.id, policy, withNewId)
  if (isPlain(local) && isPlain(incoming)) return policy === 'file' ? { ...local, ...incoming } : { ...incoming, ...local }
  return policy === 'file' ? incoming : local
}

/** How profile entries are matched: by name (and role or degree where the name alone is ambiguous). */
const PROFILE_KEY: Record<SectionKey, (x: Record<string, unknown>) => string> = {
  experience: (x) => norm(x.company) + '|' + norm(x.title),
  projects: (x) => norm(x.name),
  education: (x) => norm(x.institution) + '|' + norm(x.degree),
  skills: (x) => norm(x.group),
  languages: (x) => norm(x.name),
  certifications: (x) => norm(x.name),
  publications: (x) => norm(x.citation),
  references: (x) => norm(x.name),
}

export function profileConflicts(local: StructuredProfile | null, incoming: StructuredProfile): number {
  if (!local) return 0
  const l = normalizeStructured(local)
  const inc = normalizeStructured(incoming)
  return SECTION_KEYS.reduce((n, k) => {
    const keys = new Set((l[k] as unknown as Record<string, unknown>[]).map(PROFILE_KEY[k]))
    return n + (inc[k] as unknown as Record<string, unknown>[]).filter((x) => keys.has(PROFILE_KEY[k](x))).length
  }, 0)
}

/** Basics: 'file' lets the file's non-empty fields win; otherwise local fields win and blanks are filled from the file. */
export function mergeProfile(local: StructuredProfile, incoming: StructuredProfile, policy: Policy): StructuredProfile {
  const l = normalizeStructured(local)
  const inc = normalizeStructured(incoming)
  const filled = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) if (v !== '' && v != null && (out[k] === '' || out[k] == null)) out[k] = v
    return out
  }
  const basics = (policy === 'file' ? filled(inc.basics as unknown as Record<string, unknown>, l.basics as unknown as Record<string, unknown>) : filled(l.basics as unknown as Record<string, unknown>, inc.basics as unknown as Record<string, unknown>)) as unknown as StructuredProfile['basics']
  const out = { ...l, basics } as StructuredProfile
  const lists = out as unknown as Record<SectionKey, Record<string, unknown>[]>
  for (const k of SECTION_KEYS) {
    const key = PROFILE_KEY[k]
    const same = (a: Record<string, unknown>, b: Record<string, unknown>) => key(a) === key(b)
    if (k === 'skills' && policy === 'both') {
      // Two groups with the same name would be confusing; join their skills instead.
      lists.skills = mergeList(lists.skills, inc.skills as unknown as Record<string, unknown>[], same, 'mine').map((g) => {
        const match = inc.skills.find((x) => norm(x.group) === norm(g.group))
        return match ? { ...g, items: [...new Set([...(g.items as string[]), ...match.items])] } : g
      })
    } else {
      // New entries go after the local ones in profile sections, so the resume order does not change.
      const merged = mergeList(lists[k], inc[k] as unknown as Record<string, unknown>[], same, policy, withNewId)
      const localIds = new Set(lists[k].map((x) => x.id))
      lists[k] = [...merged.filter((x) => localIds.has(x.id)), ...merged.filter((x) => !localIds.has(x.id))]
    }
  }
  return normalizeStructured(out)
}

/* ---------- Applying ---------- */

/** Writes the selected entries of a data plan. Replace clears local data first (secrets and the undo copy stay). */
export function applyData(data: Record<string, unknown>, mode: 'merge' | 'replace', policy: Policy) {
  if (mode === 'replace') {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('jivika.') && !SECRET_KEYS.includes(k.slice(7))) localStorage.removeItem(k)
    }
  }
  for (const [k, v] of Object.entries(data)) {
    if (!isKnownKey(k)) continue
    write(k, mode === 'merge' ? mergeStored(k, read<unknown>(k, null), v, policy) : v)
  }
  const sp = read<StructuredProfile | null>('structuredProfile', null)
  if (sp && 'structuredProfile' in data && !('profile' in data)) syncProfileFromStructured(normalizeStructured(sp))
}

export function applyProfile(profile: StructuredProfile | null, resume: StoredResume | undefined, mode: 'merge' | 'replace', policy: Policy) {
  if (resume) write('resume', resume)
  if (!profile) return
  const local = read<StructuredProfile | null>('structuredProfile', null)
  const next = mode === 'replace' || !local ? normalizeStructured(profile) : mergeProfile(local, profile, policy)
  write('structuredProfile', next)
  syncProfileFromStructured(next)
}

export function applyApplications(incoming: Application[], mode: 'merge' | 'replace', policy: Policy) {
  const local = read<Application[]>('applications', []).map(migrateApplication)
  write('applications', mode === 'replace' ? incoming : mergeList(local, incoming, sameApplication, policy, withNewId))
}

/** Adds events to applications as interviews or follow-ups (or apply-by dates). Events without an application are skipped. */
export function eventsIntoApplications(apps: Application[], events: (IcsEvent & { target: string })[], policy: Policy): Application[] {
  return apps.map((a) => {
    const mine = events.filter((e) => e.target === a.id)
    if (!mine.length) return a
    let next = { ...a }
    for (const e of mine) {
      if (e.kind === 'deadline') {
        if (!next.deadline || policy === 'file') next.deadline = e.date
        continue
      }
      if (e.kind === 'followup') {
        const item = { id: e.itemId || newId(), date: e.date, note: e.notes || e.title.replace(/^follow up:\s*/i, ''), done: false }
        next.followups = mergeList(next.followups ?? [], [item], (x, y) => x.id === y.id || x.date === y.date, policy, withNewId)
        continue
      }
      const title = e.title.replace(/:\s.*$/, '') || 'Interview'
      const item = { id: e.itemId || newId(), date: e.date, time: e.time, duration_min: e.duration_min || 60, title, notes: [e.notes, e.location].filter(Boolean).join('\n') }
      next.interviews = mergeList(next.interviews ?? [], [item], (x, y) => x.id === y.id || (x.date === y.date && x.time === y.time), policy, withNewId)
    }
    return next
  })
}

/** Applications built from CSV rows, for the preview. */
export const csvApplications = (rows: string[][], mapping: Partial<Record<AppField, number>>, statusMap: Record<string, Status>) =>
  rowsToApplications(rows, mapping, statusMap, newId)
