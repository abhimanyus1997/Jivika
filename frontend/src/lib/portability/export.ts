import type { StructuredProfile } from '../api'
import { buildIcs, calendarEntries } from '../ics.ts'
import type { InboxItem } from '../inbox.ts'
import {
  DEFAULT_RESUME_SETTINGS,
  migrateApplication,
  normalizeStructured,
  read,
  today,
  type Application,
  type CoverLetterState,
  type ResumeSettings,
} from '../store.ts'
import { applicationsToCsv } from './csv.ts'
import { toEuropassXml } from './europass.ts'
import { EXPORT_FORMAT_VERSION, SECRET_KEYS } from './import.ts'
import { toJsonResume } from './jsonresume.ts'
import { toMarkdown, toPlainText } from './markdown.ts'
import { toGenericXml } from './xml.ts'
import { writeZip } from './zip.ts'

/* Every export Jivika offers, built in the browser from local storage. */

export interface JivikaFile {
  app: 'jivika'
  version: number
  exportedAt: string
  /** What the file holds: 'all', or a subset such as 'profile'. */
  scope: string
  data: Record<string, unknown>
}

const PREFIX = 'jivika.'
const parse = (raw: string | null) => {
  try {
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/** All stored entries except the API key, its verified flag, the undo copy and the holiday cache. Session storage is never read. */
export function collectAll(): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const full of Object.keys(localStorage).sort()) {
    if (!full.startsWith(PREFIX)) continue
    const k = full.slice(PREFIX.length)
    if (SECRET_KEYS.includes(k) || /apikey/i.test(k)) continue
    if (k === 'holidayCache') continue // ponytail: re-fetchable cache, not user data
    data[k] = parse(localStorage.getItem(full))
  }
  if (Array.isArray(data.applications)) data.applications = (data.applications as Application[]).map(migrateApplication)
  return data
}

export function jivikaFile(scope: string, keys?: string[]): JivikaFile {
  const all = collectAll()
  const data = keys ? Object.fromEntries(keys.filter((k) => all[k] != null).map((k) => [k, all[k]])) : all
  return { app: 'jivika', version: EXPORT_FORMAT_VERSION, exportedAt: new Date().toISOString(), scope, data }
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

const profile = (): StructuredProfile | null => {
  const p = read<StructuredProfile | null>('structuredProfile', null)
  return p && normalizeStructured(p)
}
const layout = () => ({ ...DEFAULT_RESUME_SETTINGS, ...read<Partial<ResumeSettings>>('resumeSettings', {}) })
const apps = () => read<Application[]>('applications', []).map(migrateApplication)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled'

interface Letter {
  name: string
  company: string
  role: string
  text: string
}
function letters(): Letter[] {
  const out: Letter[] = []
  const main = read<CoverLetterState | null>('coverLetter', null)
  if (main?.text?.trim()) out.push({ name: 'cover-letter', company: main.recipient?.company ?? '', role: '', text: main.text })
  for (const a of apps()) if (a.cover_letter?.text?.trim()) out.push({ name: `cover-letter-${slug(a.company)}-${slug(a.role)}`, company: a.company, role: a.role, text: a.cover_letter.text })
  return out
}
function emails() {
  const fromApps = apps()
    .filter((a) => a.email?.body?.trim())
    .map((a) => ({ name: `email-${slug(a.company)}-${slug(a.role)}`, company: a.company, role: a.role, to: a.email!.to, subject: a.email!.subject, body: a.email!.body }))
  const replies = read<InboxItem[]>('inbox', [])
    .filter((i) => i.reply?.body?.trim())
    .map((i) => ({ name: `reply-${slug(i.sender_company || i.sender_name)}-${i.id.slice(0, 8)}`, company: i.sender_company, role: '', to: i.sender_name, subject: i.reply!.subject, body: i.reply!.body }))
  return [...fromApps, ...replies]
}
const listing = (scope: string, items: unknown[]) => ({ app: 'jivika', version: EXPORT_FORMAT_VERSION, exportedAt: new Date().toISOString(), scope, readOnly: true, items })

const README = `Jivika data bundle
==================

Created by Jivika on {date}. Everything here came from this browser's local storage.
Your API key, its verified flag and session data are never included.

jivika.json        Full Jivika export (format version {version}). Import it in Settings > Data to restore everything.
jivika.xml         The same data as generic XML. Each stored item is a child of <data>; arrays have type="array" and one
                   <item> per entry; objects have type="object"; numbers, booleans and nulls carry a type attribute;
                   keys that are not valid XML names appear as <field name="key">.
applications.csv   Your applications (UTF-8 with BOM, opens in Excel). Cells that start with = + - @ are prefixed with '.
calendar.ics       Interviews, follow-ups and apply-by dates (iCalendar, RFC 5545).
resume.json        Your profile as JSON Resume (https://jsonresume.org/schema, v1.0.0).
europass.xml       Your profile as a Europass CV (Candidate XML, the format europass.europa.eu imports).
profile.md         Your resume as Markdown.
letters/*.txt      Cover letters and email drafts as plain text.
`

export type ExportId =
  | 'all-json'
  | 'all-zip'
  | 'all-xml'
  | 'profile-jsonresume'
  | 'profile-europass'
  | 'profile-jivika'
  | 'profile-md'
  | 'profile-txt'
  | 'applications-csv'
  | 'applications-json'
  | 'calendar-ics'
  | 'inbox-json'
  | 'jobs-json'
  | 'searches-json'
  | 'letters-json'
  | 'tailored-json'
  | 'emails-json'

export interface ExportFileOut {
  name: string
  type: string
  data: string | Uint8Array
}

export interface ExportDef {
  label: string
  hint: string
  group: 'Everything' | 'Profile' | 'Applications' | 'Other data'
  /** False when there is nothing to export yet. */
  ready: () => boolean
  build: (override?: StructuredProfile) => ExportFileOut
}

const has = (k: string) => localStorage.getItem(PREFIX + k) != null
const needProfile = (override?: StructuredProfile) => {
  const p = override ?? profile()
  if (!p) throw new Error('There is no structured profile yet. Build it on the Profile page first.')
  return p
}
const name = (p: StructuredProfile) => slug(p.basics.name || 'resume')

export const EXPORTS: Record<ExportId, ExportDef> = {
  'all-json': {
    label: 'Jivika backup (JSON)',
    hint: 'Everything, for importing into another browser',
    group: 'Everything',
    ready: () => true,
    build: () => ({ name: `jivika-export-${today()}.json`, type: 'application/json', data: json(jivikaFile('all')) }),
  },
  'all-zip': {
    label: 'Bundle (ZIP)',
    hint: 'Backup plus CSV, calendar, JSON Resume, Europass, Markdown and letters',
    group: 'Everything',
    ready: () => true,
    build: () => {
      const file = jivikaFile('all')
      const p = profile()
      const s = layout()
      const files: { name: string; data: string }[] = [
        { name: 'README.txt', data: README.replace('{date}', today()).replace('{version}', String(EXPORT_FORMAT_VERSION)).replace(/\n/g, '\r\n') },
        { name: 'jivika.json', data: json(file) },
        { name: 'jivika.xml', data: toGenericXml(file) },
        { name: 'applications.csv', data: applicationsToCsv(apps()) },
        { name: 'calendar.ics', data: buildIcs(calendarEntries(apps())) },
      ]
      if (p) {
        files.push({ name: 'resume.json', data: json(toJsonResume(p)) }, { name: 'europass.xml', data: toEuropassXml(p) }, { name: 'profile.md', data: toMarkdown(p, s) })
      }
      const used = new Set<string>()
      const unique = (n: string) => {
        let out = n
        for (let i = 2; used.has(out); i++) out = `${n}-${i}`
        used.add(out)
        return out
      }
      for (const l of letters()) files.push({ name: `letters/${unique(l.name)}.txt`, data: l.text.replace(/\r?\n/g, '\r\n') + '\r\n' })
      for (const e of emails()) files.push({ name: `letters/${unique(e.name)}.txt`, data: [`To: ${e.to}`, `Subject: ${e.subject}`, '', e.body].join('\r\n') + '\r\n' })
      return { name: `jivika-bundle-${today()}.zip`, type: 'application/zip', data: writeZip(files) }
    },
  },
  'all-xml': {
    label: 'Generic XML',
    hint: 'Everything as well-formed XML (jivika.xml)',
    group: 'Everything',
    ready: () => true,
    build: () => ({ name: `jivika-${today()}.xml`, type: 'application/xml', data: toGenericXml(jivikaFile('all')) }),
  },
  'profile-jsonresume': {
    label: 'JSON Resume',
    hint: 'resume.json, the open jsonresume.org format',
    group: 'Profile',
    ready: () => has('structuredProfile'),
    build: (o) => ({ name: 'resume.json', type: 'application/json', data: json(toJsonResume(needProfile(o))) }),
  },
  'profile-europass': {
    label: 'Europass CV (XML)',
    hint: 'Upload it in the Europass CV editor',
    group: 'Profile',
    ready: () => has('structuredProfile'),
    build: (o) => ({ name: `europass-${name(needProfile(o))}.xml`, type: 'application/xml', data: toEuropassXml(needProfile(o)) }),
  },
  'profile-jivika': {
    label: 'Jivika profile (JSON)',
    hint: 'Lossless: profile, section order, resume settings and custom themes',
    group: 'Profile',
    ready: () => has('structuredProfile') || has('profile'),
    build: () => ({ name: `jivika-profile-${today()}.json`, type: 'application/json', data: json(jivikaFile('profile', ['structuredProfile', 'profile', 'resumeSettings'])) }),
  },
  'profile-md': {
    label: 'Markdown',
    hint: 'profile.md',
    group: 'Profile',
    ready: () => has('structuredProfile'),
    build: (o) => ({ name: `${name(needProfile(o))}.md`, type: 'text/markdown;charset=utf-8', data: toMarkdown(needProfile(o), layout()) }),
  },
  'profile-txt': {
    label: 'Plain text',
    hint: 'For pasting into application forms',
    group: 'Profile',
    ready: () => has('structuredProfile'),
    build: (o) => ({ name: `${name(needProfile(o))}.txt`, type: 'text/plain;charset=utf-8', data: toPlainText(needProfile(o), layout()) }),
  },
  'applications-csv': {
    label: 'Applications (CSV)',
    hint: 'Opens in Excel, Google Sheets and Numbers',
    group: 'Applications',
    ready: () => apps().length > 0,
    build: () => ({ name: `jivika-applications-${today()}.csv`, type: 'text/csv;charset=utf-8', data: applicationsToCsv(apps()) }),
  },
  'applications-json': {
    label: 'Applications (JSON)',
    hint: 'With history, interviews and follow-ups',
    group: 'Applications',
    ready: () => apps().length > 0,
    build: () => ({ name: `jivika-applications-${today()}.json`, type: 'application/json', data: json(jivikaFile('applications', ['applications'])) }),
  },
  'calendar-ics': {
    label: 'Calendar (.ics)',
    hint: 'Interviews, follow-ups and apply-by dates',
    group: 'Applications',
    ready: () => calendarEntries(apps()).length > 0,
    build: () => ({ name: 'jivika-calendar.ics', type: 'text/calendar;charset=utf-8', data: buildIcs(calendarEntries(apps())) }),
  },
  'inbox-json': {
    label: 'Inbox (JSON)',
    hint: 'Classified emails and replies',
    group: 'Other data',
    ready: () => has('inbox'),
    build: () => ({ name: `jivika-inbox-${today()}.json`, type: 'application/json', data: json(jivikaFile('inbox', ['inbox'])) }),
  },
  'jobs-json': {
    label: 'Saved and hidden jobs (JSON)',
    hint: 'From Job search',
    group: 'Other data',
    ready: () => has('savedJobs') || has('dismissedJobs'),
    build: () => ({ name: `jivika-jobs-${today()}.json`, type: 'application/json', data: json(jivikaFile('jobs', ['savedJobs', 'dismissedJobs'])) }),
  },
  'searches-json': {
    label: 'Saved and past searches (JSON)',
    hint: 'From Job search',
    group: 'Other data',
    ready: () => has('savedSearches') || has('pastSearches'),
    build: () => ({ name: `jivika-searches-${today()}.json`, type: 'application/json', data: json(jivikaFile('searches', ['savedSearches', 'pastSearches'])) }),
  },
  'letters-json': {
    label: 'Cover letters (JSON)',
    hint: 'The current letter and letters saved on applications',
    group: 'Other data',
    ready: () => letters().length > 0,
    build: () => ({ name: `jivika-cover-letters-${today()}.json`, type: 'application/json', data: json(listing('cover-letters', letters())) }),
  },
  'tailored-json': {
    label: 'Tailored resumes (JSON)',
    hint: 'Every tailored version',
    group: 'Other data',
    ready: () => has('tailoredResumes'),
    build: () => ({ name: `jivika-tailored-resumes-${today()}.json`, type: 'application/json', data: json(jivikaFile('tailored-resumes', ['tailoredResumes'])) }),
  },
  'emails-json': {
    label: 'Emails (JSON)',
    hint: 'Email drafts and inbox replies',
    group: 'Other data',
    ready: () => emails().length > 0,
    build: () => ({ name: `jivika-emails-${today()}.json`, type: 'application/json', data: json(listing('emails', emails())) }),
  },
}

export function downloadFile(f: ExportFileOut) {
  const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: f.name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
