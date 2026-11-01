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
  EmailDraft,
  EmailTone,
  StructuredProfile,
  TailorResult,
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

export interface StatusChange {
  status: Status
  date: string // yyyy-mm-dd
}

export interface Application {
  id: string
  company: string
  role: string
  date: string // yyyy-mm-dd
  status: Status
  link: string
  notes: string
  /** Status changes, oldest first. Applications saved before the timeline get one from date + status. */
  history?: StatusChange[]
  /** Job description, when known (tracked from Job match or pasted in the detail view). */
  description?: string
  /** Match score from Job match, when tracked from there. */
  match?: number
  /** Last email draft for this application. */
  email?: EmailDraft & { tone: EmailTone }
}

/** Older applications have no history: start it at the applied date, plus the current status if it moved on. */
export function migrateApplication(a: Application): Application {
  if (a.history?.length) return a
  const history: StatusChange[] = [{ status: 'Applied', date: a.date }]
  if (a.status !== 'Applied') history.push({ status: a.status, date: a.date })
  return { ...a, history }
}

/** Sets the status and records the change in the timeline. */
export function withStatus(a: Application, status: Status): Application {
  const m = migrateApplication(a)
  if (m.status === status) return m
  return { ...m, status, history: [...(m.history ?? []), { status, date: today() }] }
}

export function useApplications(): [Application[], Setter<Application[]>] {
  const [apps, setApps] = useStored<Application[]>('applications', [])
  return [useMemo(() => apps.map(migrateApplication), [apps]), setApps]
}

/* ---------- Structured profile and resumes ---------- */

export const SECTION_KEYS = ['experience', 'projects', 'education', 'skills', 'languages', 'certifications', 'publications', 'references'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const emptyStructured = (): StructuredProfile => ({
  basics: { name: '', headline: '', email: '', phone: '', location: '', linkedin: '', website: '', summary: '' },
  experience: [],
  projects: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  publications: [],
  references: [],
})

/** Fills missing sections and fields, and gives every list item an id (server output or older saves may lack them). */
export function normalizeStructured(p: Partial<StructuredProfile> | null | undefined): StructuredProfile {
  const base = emptyStructured()
  const out = { ...base, ...p, basics: { ...base.basics, ...p?.basics } } as StructuredProfile
  const lists = out as unknown as Record<SectionKey, { id?: string }[]>
  for (const k of SECTION_KEYS) lists[k] = (Array.isArray(lists[k]) ? lists[k] : []).map((item) => ({ ...item, id: item.id || newId() }))
  out.experience = out.experience.map((i) => ({ ...i, bullets: Array.isArray(i.bullets) ? i.bullets : [] }))
  out.projects = out.projects.map((i) => ({ ...i, bullets: Array.isArray(i.bullets) ? i.bullets : [] }))
  out.skills = out.skills.map((g) => ({ ...g, items: Array.isArray(g.items) ? g.items : [] }))
  return out
}

export function useStructuredProfile(): [StructuredProfile | null, Setter<StructuredProfile | null>] {
  const [p, set] = useStored<StructuredProfile | null>('structuredProfile', null)
  return [useMemo(() => p && normalizeStructured(p), [p]), set]
}

/** Copies the structured basics into the simple profile that the other tools read. */
export function syncProfileFromStructured(sp: StructuredProfile) {
  const prev = read<Profile | null>('profile', null)
  const b = sp.basics
  const skills = [...new Set(sp.skills.flatMap((g) => g.items).map((s) => s.trim()).filter(Boolean))]
  const next: Profile = {
    name: '',
    headline: '',
    current_role: '',
    experience_years: 0,
    experience_months: 0,
    years_experience: 0,
    location: '',
    skills: [],
    summary: '',
    ...prev,
  }
  next.name = b.name || next.name
  next.headline = b.headline || next.headline
  next.email = b.email || next.email
  next.phone = b.phone || next.phone
  next.location = b.location || next.location
  next.linkedin = b.linkedin || next.linkedin
  next.summary = b.summary || next.summary
  next.current_role = sp.experience[0]?.title || next.current_role
  if (skills.length) next.skills = skills
  write('profile', next)
}

export type ResumeTheme = 'classic' | 'modern' | 'compact' | 'sidebar' | 'minimal' | 'executive'

export interface ResumeSettings {
  theme: ResumeTheme
  accent: string
  /** Sections left out of the rendered resume ('summary' and section keys). */
  hidden: string[]
  order: SectionKey[]
}

export const DEFAULT_RESUME_SETTINGS: ResumeSettings = { theme: 'modern', accent: '#1f7a4d', hidden: [], order: [...SECTION_KEYS] }

export function useResumeSettings(): [ResumeSettings, Setter<ResumeSettings>] {
  const [s, set] = useStored<ResumeSettings>('resumeSettings', DEFAULT_RESUME_SETTINGS)
  const value = useMemo(() => {
    const merged = { ...DEFAULT_RESUME_SETTINGS, ...s }
    // Keep only known sections, then append any added since the order was saved.
    const order = merged.order.filter((k) => SECTION_KEYS.includes(k))
    return { ...merged, order: [...order, ...SECTION_KEYS.filter((k) => !order.includes(k))] }
  }, [s])
  return [value, set]
}

export interface ResumeVersion {
  resume: StructuredProfile
  /** What made this version: the tailoring run or a refine instruction. */
  label: string
  at: string
  ai: boolean
  changes: string[]
}

export interface TailoredResume {
  id: string
  /** Application this resume belongs to (the key is the application id when tailored from one). */
  appId?: string
  job: { title: string; company: string; description: string }
  createdAt: string
  highlighted_skills: TailorResult['highlighted_skills']
  gaps: TailorResult['gaps']
  versions: ResumeVersion[]
  /** Index of the version shown. */
  current: number
}

export const useTailoredResumes = () => useStored<Record<string, TailoredResume>>('tailoredResumes', {})

/** Tailored resume linked to an application, if any. */
export const tailoredFor = (all: Record<string, TailoredResume>, appId: string) =>
  all[appId] ?? Object.values(all).find((t) => t.appId === appId)

/* ---------- Saved job searches ---------- */

export interface SavedSearch {
  id: string
  q: string
  location: string
  remote: 'any' | 'remote' | 'onsite'
  /** Source ids switched off. */
  excluded: string[]
  /** Job ids already shown for this search (capped, most recent last). */
  seen: string[]
  /** Unseen jobs found by the last check. */
  newCount: number
  checkedAt?: string
}

export const useSavedSearches = () => useStored<SavedSearch[]>('savedSearches', [])

/* ---------- Export and import ---------- */

export const EXPORT_VERSION = 1
/** Never exported, imported or replaced: the API key and its verified flag. */
const SECRET_KEYS = new Set(['apikey', 'keyVerified'])
/** Stored names an import may contain. Entries ending in '.' are prefixes. */
const KNOWN_KEYS = [
  'applications', 'applicationDraft', 'applicationsView', 'atsHistory', 'bannerDismissed', 'careerInput', 'careerPath', 'clip', 'coding',
  'coding.draft.', 'coverLetter', 'cvReview', 'funnelRange', 'history', 'interview', 'interview.tab', 'jd', 'jobSearch', 'lastMatch',
  'lastMatchJd', 'linkedinInput', 'linkedinReview', 'matches', 'profile', 'resources.', 'resume', 'resumeSettings', 'roadmapDone',
  'savedSearches', 'settings', 'sidebarCollapsed', 'signature', 'structuredProfile', 'tailoredResumes', 'tailorRequest',
]
export const isKnownKey = (k: string) => !SECRET_KEYS.has(k) && KNOWN_KEYS.some((n) => (n.endsWith('.') ? k.startsWith(n) : k === n))

export interface ExportFile {
  app: 'jivika'
  version: number
  exportedAt: string
  data: Record<string, unknown>
}

export function exportData(): ExportFile {
  const data: Record<string, unknown> = {}
  for (const full of Object.keys(localStorage)) {
    if (!full.startsWith(PREFIX)) continue
    const k = full.slice(PREFIX.length)
    if (!isKnownKey(k) || /apikey/i.test(k)) continue
    data[k] = parse(localStorage.getItem(full), null)
  }
  return { app: 'jivika', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data }
}

/** Checks an uploaded export. Returns the data to import, or an error message. */
export function validateImport(raw: unknown): { data: Record<string, unknown> } | { error: string } {
  const f = raw as Partial<ExportFile> | null
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { error: 'This file is not a Jivika export.' }
  if (typeof f.version !== 'number') return { error: 'The file has no version field, so it is not a Jivika export.' }
  if (f.version > EXPORT_VERSION) return { error: `This export is from a newer version (${f.version}). Update Jivika and try again.` }
  if (!f.data || typeof f.data !== 'object' || Array.isArray(f.data)) return { error: 'The file has no data section.' }
  const unknown = Object.keys(f.data).filter((k) => !isKnownKey(k))
  if (unknown.length) return { error: `The file contains entries Jivika does not recognise: ${unknown.slice(0, 5).join(', ')}.` }
  return { data: f.data as Record<string, unknown> }
}

const hasIds = (v: unknown): v is { id: string }[] =>
  Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Merge keeps local data and adds what is new: lists with ids are joined (imported wins on the same id), objects are combined, other values stay local. */
export function mergeValue(local: unknown, incoming: unknown): unknown {
  if (local == null) return incoming
  if (hasIds(local) && hasIds(incoming)) {
    const ids = new Set(incoming.map((x) => x.id))
    return [...incoming, ...local.filter((x) => !ids.has(x.id))]
  }
  if (isPlain(local) && isPlain(incoming)) return { ...local, ...incoming }
  return local
}

export function importData(data: Record<string, unknown>, mode: 'merge' | 'replace') {
  if (mode === 'replace') {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) && !SECRET_KEYS.has(k.slice(PREFIX.length)))
      .forEach((k) => localStorage.removeItem(k))
  }
  for (const [k, v] of Object.entries(data)) {
    if (!isKnownKey(k)) continue
    const next = mode === 'merge' ? mergeValue(parse(localStorage.getItem(PREFIX + k), null), v) : v
    if (next == null) localStorage.removeItem(PREFIX + k)
    else localStorage.setItem(PREFIX + k, JSON.stringify(next))
  }
  notify()
}

/** Moves one item in a list (for reorder buttons and drag and drop). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export const newId = () => crypto.randomUUID()
export const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd in local time
