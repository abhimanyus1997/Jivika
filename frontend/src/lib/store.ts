import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type {
  AtsResult,
  CareerPath,
  CoverLetterSender,
  CoverLetterTone,
  CVReview,
  InterviewFeedback,
  InterviewQuestion,
  LetterParts,
  LinkedInReview,
  MatchResult,
  Profile,
  ResumeMeta,
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
  /** Layout details from the PDF, for the ATS checker. Absent for pasted text. */
  meta?: ResumeMeta
  /** Which server parser read the file. Absent for pasted text and older uploads. */
  parser?: 'docling' | 'pypdf'
}

export const useResume = () => useStored<StoredResume | null>('resume', null)

/** Profiles stored before years + months existed only have years_experience (e.g. 4.5). */
export function migrateProfile(p: Profile): Profile {
  if (typeof p.experience_years === 'number' && typeof p.experience_months === 'number') return p
  const total = Math.round((Number(p.years_experience) || 0) * 12)
  return { ...p, experience_years: Math.floor(total / 12), experience_months: total % 12 }
}

export function useProfile(): [Profile | null, Setter<Profile | null>] {
  const [profile, setProfile] = useStored<Profile | null>('profile', null)
  return [useMemo(() => profile && migrateProfile(profile), [profile]), setProfile]
}

/** The job description is shared between Job Match, Interview Prep and Cover Letter. */
export const useJobDescription = () => useStored<string>('jd', '')

/* ---------- Metric history (feeds the dashboard cards) ---------- */

export interface Point {
  date: string
  value: number
}

export type Metric = 'career' | 'skills' | 'cv' | 'linkedin' | 'ats'
export type History = Record<Metric, Point[]>

const EMPTY_HISTORY: History = { career: [], skills: [], cv: [], linkedin: [], ats: [] }

export function useHistory(): [History] {
  const [history] = useStored<History>('history', EMPTY_HISTORY)
  return [{ ...EMPTY_HISTORY, ...history }] // older stored histories lack newer metrics
}

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

/** Roadmap items marked done, by item id (ids come from the skill, so they survive regenerating the plan). */
export const useRoadmapDone = () => useStored<Record<string, boolean>>('roadmapDone', {})

/** Done / total over the given items. 'have' items count as done until the user unticks them. */
export function roadmapProgress(items: { id: string; status: string }[], done: Record<string, boolean>) {
  const count = items.filter((i) => done[i.id] ?? i.status === 'have').length
  return { done: count, total: items.length, pct: items.length ? Math.round((count / items.length) * 100) : 0 }
}

export interface AtsRun {
  id: string
  date: string
  fileName: string
  job: string
  result: AtsResult
}

/** Most recent first, capped at 20. */
export const useAtsHistory = () => useStored<AtsRun[]>('atsHistory', [])

export interface InterviewSession {
  questions: InterviewQuestion[]
  answers: Record<number, string>
  feedback: Record<number, InterviewFeedback>
}

export const useInterview = () =>
  useStored<InterviewSession>('interview', { questions: [], answers: {}, feedback: {} })

export type LetterTemplate = 'classic' | 'modern' | 'compact'
export type SignatureMode = 'none' | 'typed' | 'drawn'

export interface CoverLetterState {
  tone: CoverLetterTone
  /** Plain letter as last generated. Letters saved before templates only have this. */
  text: string
  parts?: LetterParts
  template?: LetterTemplate
  /** yyyy-mm-dd; empty means today. */
  date?: string
  signature?: SignatureMode
  /** Set once the user edits their details; until then they come from the profile. */
  sender?: CoverLetterSender
  /** Optional recipient details sent with the request. */
  recipient?: { name: string; title: string; company: string }
}

export const useCoverLetter = () => useStored<CoverLetterState>('coverLetter', { tone: 'professional', text: '' })

/** Drawn signature as a PNG data URL. */
export const useSignature = () => useStored<string>('signature', '')

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
