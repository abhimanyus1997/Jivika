import { importedJobText, SOURCE_LABEL, type ImportedJob, type ImportSource } from './api'
import { write } from './store'
import { compareVersions, fetchClip } from './clipper-bridge'
import type { ImportPlan } from './portability/import'
import { isProfileClip, reviewInput, toProfileClip } from './portability/linkedin-profile'
import { CLIPPER_URL } from '../components/ClipperPromo'
import { toast } from '../components/ui'

/** The newest published Jivika Clipper. Clips from older copies (or with no version) show an update notice. */
export const LATEST_CLIPPER_VERSION = '0.2.0'

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

/** Reads #page?clip=<payload> (or #page?clipRef=<id>, held by the extension), stores the clip, and strips it from the URL. */
export async function receiveClip() {
  const [page, query = ''] = location.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  const payload = params.get('clip')
  const ref = params.get('clipRef')
  if (payload == null && ref == null) return
  const target = PAGES[page] ?? page
  history.replaceState(null, '', `${location.pathname}${location.search}#${target}`)
  dispatchEvent(new HashChangeEvent('hashchange'))
  const tooLarge = payload != null && payload.length > MAX_PAYLOAD
  let data: unknown = null
  try {
    if (payload != null) data = tooLarge ? null : await decode(payload)
    else {
      const held = await fetchClip(ref!)
      if (typeof held === 'string') data = held.length <= MAX_INFLATED ? await decode(held) : null
      else if (held && JSON.stringify(held).length <= MAX_INFLATED) data = held
    }
  } catch {
    // fall through to the error toast
  }
  if (tooLarge) return toast('The clip is too large to read. Paste the text instead.')
  if (isProfileClip(data)) receiveProfile(data, target)
  else {
    const job = toJob(data)
    if (!job) return toast(ref != null && data == null ? 'The clip could not be fetched from Jivika Clipper. Clip it again.' : 'The clipped job could not be read. Clip it again or paste the description.')
    write('jd', importedJobText(job))
    write('clip', job)
    if (target === 'new-application') {
      // ponytail: the seed startApplicationFromJob writes (pages/NewApplication.tsx); the page is already open, so it is told to read it.
      const status = (data as { status?: unknown }).status === 'Applied' ? 'Applied' : undefined
      sessionStorage.setItem('jivika.newApplicationSeed', JSON.stringify({ ...job, status }))
      dispatchEvent(new Event('jivika:seed'))
    }
    toast(`Job clipped from ${SOURCE_LABEL[job.source]}: ${job.title || 'Untitled role'}${job.company ? ` at ${job.company}` : ''}`)
  }
  updateNotice(data)
}

/** #linkedin fills the review form; anything else opens the import preview on the Profile page (read by pages/Profile.tsx). */
function receiveProfile(data: unknown, target: string) {
  const clip = toProfileClip(data)
  if (!clip) return toast('The LinkedIn profile could not be read. Scroll through it and clip again.')
  if (target === 'linkedin') {
    write('linkedinInput', { ...reviewInput(clip), clipped: true })
    return toast('LinkedIn profile loaded. Run the review when you are ready.')
  }
  // Too few sections read: let the model structure the page text instead (the server drops anything the text does not contain).
  const plan: ImportPlan =
    clip.sections < 2 && clip.raw_text
      ? { kind: 'resume-text', source: 'linkedin-profile', text: clip.raw_text }
      : { kind: 'profile', source: 'linkedin-profile', profile: clip.profile }
  write('profileClip', plan)
  if (target !== 'profile') location.hash = 'profile'
}

function updateNotice(data: unknown) {
  if (!data || typeof data !== 'object') return
  const v = (data as { clipper_version?: unknown }).clipper_version
  if (compareVersions(typeof v === 'string' ? v : '', LATEST_CLIPPER_VERSION) < 0)
    setTimeout(() => toast('A newer Jivika Clipper is available', { href: CLIPPER_URL, label: 'Update' }), 2600)
}
