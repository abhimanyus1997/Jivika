import { importedJobText, SOURCE_LABEL, type ImportedJob, type ImportSource } from './api'
import { write } from './store'
import { toast } from '../components/ui'

/** Clipper page names (spec) -> app page ids. */
const PAGES: Record<string, string> = { match: 'match', ats: 'ats', cover: 'cover-letter', interview: 'interview' }
const FIELDS = ['title', 'company', 'location', 'employment_type', 'experience_required', 'salary', 'url', 'posted_at'] as const

const MAX_PAYLOAD = 64000
const MAX_INFLATED = 256 * 1024

async function decode(payload: string): Promise<unknown> {
  const zipped = payload.startsWith('z.')
  const b64 = (zipped ? payload.slice(2) : payload).replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes])
  if (!zipped) return JSON.parse(await blob.text())
  // Cap inflation: a valid clip is ~22 KB of JSON, so a deflate bomb stops at 256 KB.
  const reader = blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_INFLATED) {
      await reader.cancel()
      throw new Error('Clip payload too large')
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.byteLength
  }
  const text = new TextDecoder().decode(all)
  return JSON.parse(text)
}

/** Validates the untrusted payload; every value is kept as capped plain text (React renders it escaped). */
export function toJob(data: unknown): ImportedJob | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const description = str(d.description, 20000)
  if (!description) return null
  const source = str(d.source, 300)
  const job = { description, source: (Object.hasOwn(SOURCE_LABEL, source) ? source : 'page') as ImportSource } as ImportedJob
  for (const f of FIELDS) job[f] = str(d[f], 300)
  if (!/^https?:\/\//i.test(job.url)) job.url = ''
  return job
}

/** Reads #page?clip=<payload>, stores the job as the current JD, and strips the payload from the URL. */
export async function receiveClip() {
  const [page, query = ''] = location.hash.slice(1).split('?')
  const payload = new URLSearchParams(query).get('clip')
  if (payload == null) return
  if (payload.length > MAX_PAYLOAD) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${PAGES[page] ?? page}`)
    return toast('The clipped job is too large to read. Paste the description instead.')
  }
  history.replaceState(null, '', `${location.pathname}${location.search}#${PAGES[page] ?? page}`)
  dispatchEvent(new HashChangeEvent('hashchange'))
  let job: ImportedJob | null = null
  try {
    job = toJob(await decode(payload))
  } catch {
    // fall through to the error toast
  }
  if (!job) return toast('The clipped job could not be read. Clip it again or paste the description.')
  write('jd', importedJobText(job))
  write('clip', job)
  toast(`Job clipped from ${SOURCE_LABEL[job.source]}: ${job.title || 'Untitled role'}${job.company ? ` at ${job.company}` : ''}`)
}
