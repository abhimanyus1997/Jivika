import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type {
  CareerPath,
  CoverLetterTone,
  CVReview,
  InterviewFeedback,
  InterviewQuestion,
  LinkedInReview,
  MatchResult,
  Profile,
} from './api'

// All user data lives in the browser. Every key is namespaced so "Clear all" can find it.
const PREFIX = 'jivika.'
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('storage', notify)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function read<T>(key: string, fallback: T, storage: Storage = localStorage): T {
  return parse(storage.getItem(PREFIX + key), fallback)
}

export function write(key: string, value: unknown, storage: Storage = localStorage) {
  if (value === undefined || value === null) storage.removeItem(PREFIX + key)
  else storage.setItem(PREFIX + key, JSON.stringify(value))
  notify()
}

type Setter<T> = (next: T | ((prev: T) => T)) => void

export function useStored<T>(key: string, fallback: T): [T, Setter<T>] {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(PREFIX + key))
  // fallback is intentionally not a dependency: callers pass inline literals.
  const value = useMemo(() => parse(raw, fallback), [raw])
  const set = useCallback<Setter<T>>(
    (next) => {
      const prev = read(key, fallback)
      write(key, typeof next === 'function' ? (next as (p: T) => T)(prev) : next)
    },
    [key],
  )
  return [value, set]
}

export function clearAll() {
  for (const storage of [localStorage, sessionStorage]) {
    Object.keys(storage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => storage.removeItem(k))
  }
  notify()
}

/* ---------- Settings and API key ---------- */

export interface Settings {
  provider: string
  model: string
  remember: boolean
}

export const DEFAULT_SETTINGS: Settings = { provider: 'gemini', model: '', remember: false }

export const useSettings = () => useStored<Settings>('settings', DEFAULT_SETTINGS)

export function getKey(): string {
  return read('apikey', '', sessionStorage) || read('apikey', '', localStorage)
}

/** Remembered keys go to localStorage; otherwise sessionStorage (cleared when the tab closes). */
export function saveKey(key: string, remember: boolean) {
  const verified = isKeyVerified()
  for (const storage of [localStorage, sessionStorage]) {
    write('apikey', null, storage)
    write('keyVerified', null, storage)
  }
  if (!key) return
  const storage = remember ? localStorage : sessionStorage
  write('apikey', key, storage)
  if (verified) write('keyVerified', true, storage)
}

/** Set after a successful Verify; cleared whenever the key, provider or model changes. */
export function isKeyVerified(): boolean {
  return read('keyVerified', false, sessionStorage) || read('keyVerified', false, localStorage)
}

export function setKeyVerified(ok: boolean) {
  const { remember } = read<Settings>('settings', DEFAULT_SETTINGS)
  write('keyVerified', null, localStorage)
  write('keyVerified', null, sessionStorage)
  if (ok) write('keyVerified', true, remember ? localStorage : sessionStorage)
}

export const useKeyVerified = () => useSyncExternalStore(subscribe, isKeyVerified)

export function useApiKey(): string {
  return useSyncExternalStore(subscribe, getKey)
}

export function getCredentials() {
  return { ...read<Settings>('settings', DEFAULT_SETTINGS), key: getKey() }
}

/* ---------- Resume and profile ---------- */

export interface StoredResume {
  text: string
  pages: number
  characters: number
  fileName: string
}

export const useResume = () => useStored<StoredResume | null>('resume', null)
export const useProfile = () => useStored<Profile | null>('profile', null)

/** The job description is shared between Job Match, Interview Prep and Cover Letter. */
export const useJobDescription = () => useStored<string>('jd', '')

/* ---------- Metric history (feeds the dashboard cards) ---------- */

export interface Point {
  date: string
  value: number
}

export type Metric = 'career' | 'skills' | 'cv' | 'linkedin'
export type History = Record<Metric, Point[]>

const EMPTY_HISTORY: History = { career: [], skills: [], cv: [], linkedin: [] }

export const useHistory = () => useStored<History>('history', EMPTY_HISTORY)

export function pushHistory(metric: Metric, value: number) {
  const history = { ...EMPTY_HISTORY, ...read<History>('history', EMPTY_HISTORY) }
  history[metric] = [...history[metric], { date: new Date().toISOString(), value }].slice(-30)
  write('history', history)
}

/* ---------- Saved results ---------- */

export interface SavedMatch {
  id: string
  savedAt: string
  job_description: string
  result: MatchResult
}

export const useMatches = () => useStored<SavedMatch[]>('matches', [])
export const useLastMatch = () => useStored<MatchResult | null>('lastMatch', null)
/** The job description the last match was run against (the shared 'jd' may have been edited since). */
export const useLastMatchJd = () => useStored<string>('lastMatchJd', '')
export const useCvReview = () => useStored<CVReview | null>('cvReview', null)
export const useLinkedInReview = () => useStored<LinkedInReview | null>('linkedinReview', null)
export const useCareerPath = () => useStored<CareerPath | null>('careerPath', null)

export interface InterviewSession {
  questions: InterviewQuestion[]
  answers: Record<number, string>
  feedback: Record<number, InterviewFeedback>
}

export const useInterview = () =>
  useStored<InterviewSession>('interview', { questions: [], answers: {}, feedback: {} })

export const useCoverLetter = () =>
  useStored<{ tone: CoverLetterTone; text: string }>('coverLetter', { tone: 'professional', text: '' })

/* ---------- Application tracker ---------- */

export const STATUSES = [
  'Applied',
  'Awaiting response',
  'Response received',
  'Interview',
  'Offer',
  'Rejected',
] as const

export type Status = (typeof STATUSES)[number]

export interface Application {
  id: string
  company: string
  role: string
  date: string // yyyy-mm-dd
  status: Status
  link: string
  notes: string
}

export const useApplications = () => useStored<Application[]>('applications', [])

export const newId = () => crypto.randomUUID()
export const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd in local time
