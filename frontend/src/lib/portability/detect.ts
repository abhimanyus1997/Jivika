import { looksLikeApplications, parseCsv, sniffDelimiter } from './csv.ts'
import { isJsonResume } from './jsonresume.ts'
import { isLinkedInExport } from './linkedin-export.ts'
import { isZip, zipNames } from './zip.ts'

/* Works out what a file is from its content. The extension is only a tie-breaker for binary resumes. */

export type FileKind =
  | 'jivika-json'
  | 'jivika-zip'
  | 'jsonresume'
  | 'europass-xml'
  | 'europass-json'
  | 'linkedin-zip'
  | 'applications-csv'
  | 'ics'
  | 'text-resume'
  | 'resume-file'
  | 'unknown'

export const KIND_LABEL: Record<FileKind, string> = {
  'jivika-json': 'Jivika export',
  'jivika-zip': 'Jivika ZIP bundle',
  jsonresume: 'JSON Resume',
  'europass-xml': 'Europass CV (XML)',
  'europass-json': 'Europass CV (JSON, legacy)',
  'linkedin-zip': 'LinkedIn data export',
  'applications-csv': 'Applications spreadsheet (CSV)',
  ics: 'Calendar (.ics)',
  'text-resume': 'Resume text',
  'resume-file': 'Resume document',
  unknown: 'Unknown file',
}

export const MB = 1024 * 1024
export const TEXT_LIMIT = 10 * MB
export const ZIP_LIMIT = 25 * MB
export const RESUME_FILE_LIMIT = 10 * MB

const starts = (b: Uint8Array, ...sig: number[]) => sig.every((x, i) => b[i] === x)
export const isPdf = (b: Uint8Array) => starts(b, 0x25, 0x50, 0x44, 0x46)
const isImage = (b: Uint8Array) => starts(b, 0x89, 0x50, 0x4e, 0x47) || starts(b, 0xff, 0xd8, 0xff)

/** UTF-8 text, or UTF-16 when the file starts with a UTF-16 byte order mark. The BOM is removed. */
export function decodeText(b: Uint8Array): string {
  if (starts(b, 0xff, 0xfe)) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (starts(b, 0xfe, 0xff)) return new TextDecoder('utf-16be').decode(b.subarray(2))
  return new TextDecoder().decode(b).replace(/^\uFEFF/, '')
}

/** True when the bytes look like text (no NUL bytes in the first 8 KB). */
const isText = (b: Uint8Array) => !b.subarray(0, 8192).includes(0) || starts(b, 0xff, 0xfe) || starts(b, 0xfe, 0xff)

export function detectKind(name: string, bytes: Uint8Array): FileKind {
  if (isZip(bytes)) {
    let names: string[]
    try {
      names = zipNames(bytes)
    } catch {
      return 'unknown'
    }
    if (names.includes('jivika.json')) return 'jivika-zip'
    if (isLinkedInExport(names)) return 'linkedin-zip'
    if (names.includes('word/document.xml')) return 'resume-file'
    return 'unknown'
  }
  if (isPdf(bytes) || isImage(bytes)) return 'resume-file'
  if (!isText(bytes)) return /\.docx?$/i.test(name) ? 'resume-file' : 'unknown'
  const text = decodeText(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    let v: unknown
    try {
      v = JSON.parse(decodeText(bytes))
    } catch {
      return 'unknown'
    }
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    if (o.app === 'jivika') return 'jivika-json'
    if ('SkillsPassport' in o) return 'europass-json'
    if (isJsonResume(v)) return 'jsonresume'
    return 'unknown'
  }
  if (t.startsWith('<')) {
    const root = t.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/^(<!--[\s\S]*?-->\s*)+/, '')
    if (/^<(\w+:)?(Candidate|SkillsPassport)\b/.test(root)) return 'europass-xml'
    // DOCTYPE or ENTITY in a Europass file: route to parseXmlSafe so the user sees why it is refused.
    if (/<!(DOCTYPE|ENTITY)/i.test(t) && /<(\w+:)?(Candidate|SkillsPassport)\b/.test(t)) return 'europass-xml'
    if (/^<(!DOCTYPE\s+)?html/i.test(root)) return 'text-resume'
    return 'unknown'
  }
  if (/^BEGIN:VCALENDAR/i.test(t)) return 'ics'
  const firstLine = t.split(/\r?\n/, 1)[0]
  if (/[,;\t]/.test(firstLine)) {
    // Any table goes to the CSV import; unmatched headers are handled by the dialog's column mapping.
    const rows = parseCsv(t, sniffDelimiter(t)).slice(0, 5)
    if (looksLikeApplications(rows[0] ?? []) || (rows.length >= 2 && rows[0].length >= 2 && rows.every((r) => r.length === rows[0].length))) return 'applications-csv'
  }
  return t.trim() ? 'text-resume' : 'unknown'
}
