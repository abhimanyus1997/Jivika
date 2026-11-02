/* Talks to Jivika Clipper through externally_connectable (Chromium only). The extension checks the page origin itself. */

/** Derived from the public 'key' in extension/src/manifest.json, so every unpacked copy has this ID. */
export const EXTENSION_ID = 'agnjhcpbahadbpobhkjnjifepombmjdo'
/** Developers loading a copy with another key can set localStorage['jivika.clipperId']. */
const OVERRIDE_KEY = 'jivika.clipperId'
export const MAX_MESSAGE = 200 * 1024

export interface Answers {
  notice_period?: string
  expected_salary?: string
  current_salary?: string
  work_authorization?: string
  sponsorship_needed?: string
  willing_to_relocate?: string
  earliest_start?: string
  pronouns?: string
  gender?: string
  ethnicity?: string
  veteran?: string
  disability?: string
  linkedin?: string
  github?: string
  portfolio?: string
  how_heard?: string
}

export const DEFAULT_ANSWERS: Answers = { gender: 'Prefer not to say', ethnicity: 'Decline to answer', veteran: 'Decline to answer', disability: 'Decline to answer' }

type Runtime = { sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: unknown }
const runtime = () => (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime

export const isChromium = () => /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent)

export function extensionId() {
  const id = localStorage.getItem(OVERRIDE_KEY)?.trim()
  return id && /^[a-p]{32}$/.test(id) ? id : EXTENSION_ID
}

/** The extension's reply, or null when it is not installed, not allowed on this origin, or does not answer in time. */
export function send<T = Record<string, unknown>>(msg: { type: string } & Record<string, unknown>, timeout = 2000): Promise<T | null> {
  const rt = runtime()
  if (!rt?.sendMessage) return Promise.resolve(null)
  if (new TextEncoder().encode(JSON.stringify(msg)).length > MAX_MESSAGE) return Promise.reject(new Error('This is too large to send to Jivika Clipper (over 200 KB).'))
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout)
    try {
      rt.sendMessage(extensionId(), msg, (reply) => {
        clearTimeout(timer)
        // Reading lastError marks it handled; a missing extension lands here.
        resolve(rt.lastError || !reply || typeof reply !== 'object' ? null : (reply as T))
      })
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

export const ping = () => send<{ ok: boolean; version?: string; connected?: boolean; syncedAt?: number | null }>({ type: 'jivika.ping' }, 1000)

/** A clip too large for the URL, held by the extension until the app asks for it. */
export async function fetchClip(id: string): Promise<unknown> {
  if (!/^[\w-]{1,64}$/.test(id)) return null
  const r = await send<{ payload?: unknown }>({ type: 'jivika.fetchClip', id }, 4000)
  return r?.payload ?? null
}

/** -1, 0 or 1. Missing parts count as 0; a missing version is older than any. */
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}
