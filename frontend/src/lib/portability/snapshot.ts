/* One level of undo for imports: a copy of every jivika.* entry (except secrets) in 'jivika.importSnapshot'. */

const PREFIX = 'jivika.'
const KEY = PREFIX + 'importSnapshot'
const SKIP = new Set([KEY, PREFIX + 'apikey', PREFIX + 'keyVerified'])

interface Snapshot {
  at: string
  label: string
  entries: Record<string, string>
}

const ours = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !SKIP.has(k))

/** Saves the copy. Returns false (and removes any older copy) when browser storage is too full to hold it. */
export function takeSnapshot(label: string): boolean {
  const entries: Record<string, string> = {}
  for (const k of ours()) entries[k] = localStorage.getItem(k) ?? ''
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), label, entries } satisfies Snapshot))
    return true
  } catch {
    // An older copy left in place would undo this import and everything since; drop it.
    localStorage.removeItem(KEY)
    return false
  }
}

export function snapshotInfo(): { at: string; label: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Snapshot | null
    return s && typeof s.at === 'string' ? { at: s.at, label: s.label } : null
  } catch {
    return null
  }
}

/** Restores the copy and removes it. Returns false when there is nothing to undo. */
export function undoImport(): boolean {
  let s: Snapshot | null
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    s = null
  }
  if (!s || !s.entries || typeof s.entries !== 'object') return false
  for (const k of ours()) localStorage.removeItem(k)
  for (const [k, v] of Object.entries(s.entries)) if (k.startsWith(PREFIX) && !SKIP.has(k)) localStorage.setItem(k, v)
  localStorage.removeItem(KEY)
  // Same-tab listeners only hear 'storage' events from other tabs; send one so every useStored hook rereads.
  window.dispatchEvent(new StorageEvent('storage'))
  return true
}

export const discardSnapshot = () => localStorage.removeItem(KEY)
