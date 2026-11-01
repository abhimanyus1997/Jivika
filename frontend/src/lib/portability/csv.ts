import type { Application, Status, WorkMode } from '../store'

/* RFC 4180 CSV, and the applications CSV export and import. */

/** Parses CSV text (comma, or the given delimiter). Quoted fields may hold delimiters, quotes ("") and line breaks. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Picks the delimiter that splits the header line into the most columns. */
export function sniffDelimiter(text: string): string {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  return [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
}

/** Spreadsheet formula injection guard: cells starting with = + - @ tab or CR get a leading single quote. */
export const defuse = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** CSV text with CRLF line ends. Every cell is defused, then quoted when needed. */
export const toCsv = (rows: (string | number | undefined | null)[][]) => rows.map((r) => r.map((c) => quote(defuse(c == null ? '' : String(c)))).join(',')).join('\r\n') + '\r\n'

/* ---------- Applications ---------- */

export const APP_COLUMNS = ['Company', 'Role', 'Status', 'Applied date', 'Sent date', 'Deadline', 'Location', 'Work mode', 'Salary', 'Link', 'Match', 'Notes'] as const

/** UTF-8 BOM first so Excel reads the file as UTF-8. */
export function applicationsToCsv(apps: Application[]): string {
  const rows = apps.map((a) => [a.company, a.role, a.status, a.date, a.sent, a.deadline, a.location, a.work_mode, a.salary, a.link, a.match, a.notes])
  return '\uFEFF' + toCsv([[...APP_COLUMNS], ...rows])
}

export type AppField = 'company' | 'role' | 'status' | 'date' | 'sent' | 'deadline' | 'location' | 'work_mode' | 'salary' | 'link' | 'match' | 'notes'

export const FIELD_LABEL: Record<AppField, string> = {
  company: 'Company',
  role: 'Role',
  status: 'Status',
  date: 'Applied date',
  sent: 'Sent date',
  deadline: 'Deadline',
  location: 'Location',
  work_mode: 'Work mode',
  salary: 'Salary',
  link: 'Link',
  match: 'Match',
  notes: 'Notes',
}

const SYNONYMS: Record<AppField, string[]> = {
  company: ['company', 'employer', 'organisation', 'organization', 'company name'],
  role: ['role', 'title', 'position', 'job', 'job title'],
  status: ['status', 'stage'],
  date: ['date', 'applied', 'date applied', 'applied date', 'applied on'],
  sent: ['sent date', 'sent'],
  deadline: ['deadline', 'apply by', 'closing date'],
  location: ['location', 'city'],
  work_mode: ['work mode', 'remote', 'workplace'],
  salary: ['salary', 'pay', 'compensation'],
  link: ['link', 'url', 'job link', 'job url'],
  match: ['match', 'match score'],
  notes: ['notes', 'note', 'comments'],
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ')

/** Column index per field, from header names (case-insensitive, with synonyms). Unmatched fields are absent. */
export function autoMap(headers: string[]): Partial<Record<AppField, number>> {
  const out: Partial<Record<AppField, number>> = {}
  headers.forEach((h, i) => {
    const n = norm(h)
    const field = (Object.keys(SYNONYMS) as AppField[]).find((f) => SYNONYMS[f].includes(n) && out[f] === undefined)
    if (field) out[field] = i
  })
  return out
}

/** True when the header row looks like an applications list (needs a company or a role column). */
export const looksLikeApplications = (headers: string[]) => {
  const m = autoMap(headers)
  return m.company !== undefined || m.role !== undefined
}

const STATUS_SYNONYMS: [RegExp, Status][] = [
  [/^(wishlist|saved|bookmarked|to apply|interested|draft)$/, 'Draft'],
  [/declined by company|rejected|not selected|unsuccessful/, 'Rejected'],
  [/withdrawn|withdrew/, 'Withdrawn'],
  [/accepted|hired/, 'Accepted'],
  [/declined/, 'Declined'],
  [/offer/, 'Offer'],
  [/phone screen|recruiter (call|screen)|screening|hr (call|round)/, 'Screening'],
  [/onsite|on-site|final round|interview|technical|assessment/, 'Interview'],
  [/ghosted|no response|applied|submitted|awaiting/, 'Applied'],
]

/** Best guess at a Jivika status for an external one; the import dialog lets the user change it. */
export function mapStatus(external: string): Status {
  const s = norm(external)
  if (!s) return 'Applied'
  return STATUS_SYNONYMS.find(([re]) => re.test(s))?.[1] ?? 'Applied'
}

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-mm-dd from ISO, d/m/y (or m/d/y when the second number is over 12), or anything Date can read. '' when unreadable. */
export function parseDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    // ponytail: ambiguous dates read as day/month (the Indian and European order); a date-order option if users ask.
    let [d, mo] = [+m[1], +m[2]]
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : ''
  }
  const t = new Date(s)
  return isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

const MODES: WorkMode[] = ['On-site', 'Hybrid', 'Remote']
const workMode = (s: string): WorkMode => MODES.find((m) => norm(m).replace('-', '') === norm(s).replace('-', '')) ?? ''

/** Turns data rows into applications. Status text goes through `statusMap` (external text to status), then mapStatus. */
export function rowsToApplications(
  rows: string[][],
  mapping: Partial<Record<AppField, number>>,
  statusMap: Record<string, Status> = {},
  newId: () => string = () => crypto.randomUUID(),
  fallbackDate = parseDate(new Date().toISOString()),
): Application[] {
  const get = (r: string[], f: AppField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim())
  // Undo the export's formula guard so round trips are exact.
  const undefuse = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s)
  return rows
    .map((r) => r.map(undefuse))
    .filter((r) => get(r, 'company') || get(r, 'role'))
    .map((r) => {
      const external = get(r, 'status')
      const status = statusMap[external] ?? mapStatus(external)
      const date = parseDate(get(r, 'date')) || fallbackDate
      const match = Number(get(r, 'match'))
      const a: Application = {
        id: newId(),
        company: get(r, 'company'),
        role: get(r, 'role'),
        date,
        status,
        link: get(r, 'link'),
        notes: get(r, 'notes'),
        history: status === 'Applied' || status === 'Draft' ? [{ status, date }] : [{ status: 'Applied', date }, { status, date }],
      }
      const opt: Partial<Application> = {
        sent: parseDate(get(r, 'sent')),
        deadline: parseDate(get(r, 'deadline')),
        location: get(r, 'location'),
        work_mode: workMode(get(r, 'work_mode')),
        salary: get(r, 'salary'),
        match: get(r, 'match') && Number.isFinite(match) ? Math.max(0, Math.min(100, Math.round(match))) : undefined,
      }
      for (const [k, v] of Object.entries(opt)) if (v !== '' && v !== undefined) (a as unknown as Record<string, unknown>)[k] = v
      return a
    })
}
