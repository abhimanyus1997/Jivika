import { useCallback, useState, useSyncExternalStore } from 'react'
import { getCredentials, useApiKey } from './store'

/* ---------- Contract types (mirror the FastAPI schemas) ---------- */

export interface Provider {
  id: string
  name: string
  default_model: string
  key_url: string
  json_mode?: boolean
}

/** Used until /api/providers responds, and if it cannot be reached. */
export const FALLBACK_PROVIDERS: Provider[] = [
  { id: 'gemini', name: 'Google Gemini', default_model: 'gemini-3.8-flash', key_url: 'https://aistudio.google.com/apikey', json_mode: true },
  { id: 'openai', name: 'OpenAI', default_model: 'gpt-6-luna', key_url: 'https://platform.openai.com/api-keys', json_mode: true },
  { id: 'anthropic', name: 'Anthropic Claude', default_model: 'claude-haiku-5-5', key_url: 'https://platform.claude.com/settings/keys', json_mode: false },
  { id: 'groq', name: 'Groq', default_model: 'openai/gpt-oss-120b', key_url: 'https://console.groq.com/keys', json_mode: true },
  { id: 'mistral', name: 'Mistral AI', default_model: 'mistral-small-latest', key_url: 'https://console.mistral.ai/api-keys', json_mode: true },
  { id: 'deepseek', name: 'DeepSeek', default_model: 'deepseek-flash', key_url: 'https://platform.deepseek.com/api_keys', json_mode: true },
  { id: 'xai', name: 'xAI Grok', default_model: 'grok-4.20-0309-non-reasoning', key_url: 'https://console.x.ai', json_mode: true },
  { id: 'openrouter', name: 'OpenRouter', default_model: 'openai/gpt-6-luna', key_url: 'https://openrouter.ai/keys', json_mode: true },
  { id: 'qwen', name: 'Qwen (Alibaba Cloud)', default_model: 'qwen3.8-flash', key_url: 'https://modelstudio.console.alibabacloud.com/model/settings/api-key', json_mode: true },
]

/* ---------- Live model lists ---------- */

export interface ModelInfo {
  id: string
  name?: string
  context_length?: number
  created?: number
  /** USD per million tokens. */
  input_price?: number
  output_price?: number
}

export interface ModelList {
  models: ModelInfo[]
  recommended: string
  source: 'live' | 'fallback'
  fetched_at: string
  error?: string
  demo?: boolean
}

export interface DemoStatus {
  enabled: boolean
  provider: string
  provider_name: string
  model: string
  hourly_limit: number
  daily_limit: number
  remaining_hourly: number | null
}

/* ---------- Live job search ---------- */

export type RemoteFilter = 'any' | 'remote' | 'onsite'

export interface Job {
  id: string
  source: string
  title: string
  company: string
  location: string
  remote: boolean | null
  employment_type?: string
  salary?: string
  posted_at?: string
  url: string
  snippet: string
  description?: string
}

export interface JobSource {
  id: string
  name: string
  enabled: boolean
  ok: boolean
  count: number
  error?: string
  research: boolean
}

export interface JobSearchResult {
  jobs: Job[]
  sources: JobSource[]
  query: string
}

export interface JobSearchParams {
  q: string
  location?: string
  remote?: RemoteFilter
  sources?: string[]
  page?: number
}

export interface ResumeMeta {
  pages: number
  images: number
  fonts: number
  has_text_layer: boolean
  avg_chars_per_page: number
  suspected_columns: boolean
  suspected_tables: boolean
  file_name?: string | null
}

export interface ParsedResume {
  text: string
  pages: number
  characters: number
  meta?: ResumeMeta
}

export interface Profile {
  name: string
  headline: string
  current_role: string
  experience_years: number
  experience_months: number
  /** years + months / 12, kept for older stored profiles. */
  years_experience: number
  /** Client-only: the user entered experience themselves, so 0 / 0 means "less than a month". */
  experience_set?: boolean
  location: string
  skills: string[]
  summary: string
}

export interface TransitionStep {
  step: string
  detail: string
  timeframe: string
}

export interface MatchResult {
  job_title: string
  company: string
  location: string
  employment_type: string
  experience_required: string
  salary_range: string
  match_score: number
  keyword_coverage: number
  matched_skills: string[]
  missing_skills: string[]
  strengths: string[]
  gaps: string[]
  challenges: string[]
  opportunities: string[]
  transition_plan: TransitionStep[]
  summary: string
}

export interface CVReview {
  ats_score: number
  overall: string
  sections: { name: string; score: number; feedback: string }[]
  bullet_rewrites: { original: string; improved: string }[]
  quick_wins: string[]
}

export interface LinkedInReview {
  score: number
  headline_suggestions: string[]
  about_rewrite: string
  keyword_suggestions: string[]
  tips: string[]
}

export type RoadmapStatus = 'have' | 'next' | 'later'

export interface RoadmapItem {
  id: string
  skill: string
  status: RoadmapStatus
  why: string
  project: string
  estimate: string
  roadmap_sh_url?: string | null
}

export interface Roadmap {
  title: string
  roadmap_sh: { slug: string; name: string; url: string } | null
  stages: { name: string; items: RoadmapItem[] }[]
}

export interface CareerPath {
  current: { title: string; salary_range: string }
  next: { title: string; salary_range: string; timeframe: string }
  future: { title: string; salary_range: string; timeframe: string }
  skills_to_build: { skill: string; why: string; resource: string }[]
  career_score: number
  rationale: string
  /** Missing on paths saved before roadmaps existed. */
  roadmap?: Roadmap
}

/* ---------- Job import ---------- */

export type ImportSource = 'linkedin' | 'naukri' | 'jsonld' | 'text'

export interface ImportedJob {
  title: string
  company: string
  location: string
  employment_type: string
  experience_required: string
  salary: string
  description: string
  url: string
  source: ImportSource
  posted_at?: string | null
}

/* ---------- ATS checker ---------- */

export type AtsCategory = 'parsing' | 'sections' | 'contact' | 'formatting' | 'keywords' | 'content'
export type AtsStatus = 'pass' | 'warn' | 'fail'

export interface AtsResult {
  score: number
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs work'
  summary: string
  checks: { id: string; category: AtsCategory; label: string; status: AtsStatus; detail: string; fix?: string | null }[]
  keywords: null | {
    title_match: boolean
    required_found: string[]
    required_missing: string[]
    preferred_found: string[]
    preferred_missing: string[]
    top_terms: { term: string; jd_count: number; resume_count: number }[]
  }
  fixes: { priority: 'high' | 'medium' | 'low'; text: string }[]
  categories?: Partial<Record<AtsCategory, number>>
  note?: string | null
}

/* ---------- Market salary data ---------- */

export interface SalaryRange {
  source: string
  source_name: string
  label: string
  min: number
  max: number
  median?: number | null
  currency: string
  period: 'year'
  sample_size?: number | null
  as_of?: string | null
  url?: string | null
  research: boolean
}

export interface SalaryResult {
  query: { title: string; location: string; company: string; currency: string }
  ranges: SalaryRange[]
  sources: { id: string; name: string; enabled: boolean; ok: boolean; error?: string; research: boolean }[]
  levels_url: string
}

export type QuestionType = 'behavioral' | 'technical' | 'situational'

export interface InterviewQuestion {
  question: string
  type: QuestionType
  what_they_look_for: string
}

export interface InterviewFeedback {
  score: number
  strengths: string[]
  improvements: string[]
  improved_answer: string
}

export type CoverLetterTone = 'professional' | 'enthusiastic' | 'concise'

export const CURRENCIES = ['INR', 'USD', 'GBP', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]

/* ---------- Transport ---------- */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The server's 429 text when the shared demo quota runs out. */
export const isDemoLimit = (message: string) => /demo limit/i.test(message)

const UNREACHABLE = 'Cannot reach the Jivika server. Make sure it is running and try again.'

function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  // FastAPI validation errors arrive as a list of {loc, msg}.
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => (d as { msg?: string }).msg ?? 'Invalid request.').join(' ')
  }
  // Vercel rejects bodies over 4.5 MB itself, without a JSON detail.
  if (status === 413) return 'The PDF is too large to upload. Try a smaller file.'
  // A dev proxy or gateway answers 502-504 without a JSON body when the API is down.
  if (status >= 502 && status <= 504) return UNREACHABLE
  return `Request failed (${status}).`
}

/* ---------- Demo mode (shared server-side key, used when the browser has no key) ---------- */

let demo: DemoStatus | null = null
const demoSubs = new Set<() => void>()
function setDemo(next: DemoStatus | null) {
  demo = next
  demoSubs.forEach((f) => f())
}
const subscribeDemo = (cb: () => void) => {
  demoSubs.add(cb)
  return () => {
    demoSubs.delete(cb)
  }
}

/** Fetches /api/demo once per page load. */
export function loadDemo() {
  request<DemoStatus>('/demo').then(setDemo, () => undefined)
}

export const useDemo = () => useSyncExternalStore(subscribeDemo, () => demo)

/** The demo status when demo mode is in use (enabled and no key of the user's own), else null. */
export function useDemoActive(): DemoStatus | null {
  const key = useApiKey()
  const d = useDemo()
  return !key && d?.enabled ? d : null
}

/** True when AI actions can run: the user has a key, or the demo model is available. */
export function useAiReady(): boolean {
  const key = useApiKey()
  const d = useDemo()
  return !!key || !!d?.enabled
}

/**
 * ai: true sends the user's key and needs a key or demo mode; 'optional' sends the key when there is one
 * (the endpoint also works without a model). POST is used whenever there is a body or `ai: true`.
 */
async function request<T>(
  path: string,
  init: { body?: unknown; form?: FormData; ai?: boolean | 'optional'; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers }
  if (init.ai) {
    const { provider, model, key } = getCredentials()
    if (key) {
      headers['X-LLM-Provider'] = provider
      headers['X-LLM-Key'] = key
      if (model.trim()) headers['X-LLM-Model'] = model.trim()
    } else if (init.ai === true && !demo?.enabled) {
      throw new ApiError(401, 'Add your API key in Settings to use this tool.')
    }
    // With no key the server uses its demo model and ignores provider/model, so none are sent.
  }
  let body: BodyInit | undefined
  if (init.form) body = init.form
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const method = body || init.ai === true ? 'POST' : 'GET'

  let res: Response
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  const remaining = res.headers.get('X-Jivika-Demo-Remaining')
  if (res.headers.get('X-Jivika-Demo') === '1' && demo && remaining !== null && remaining !== '' && !Number.isNaN(Number(remaining))) {
    setDemo({ ...demo, remaining_hourly: Number(remaining) })
  }
  const data: unknown = await res.json().catch(() => null)
  if (res.status === 429 && demo && isDemoLimit(errorMessage(res.status, data))) setDemo({ ...demo, remaining_hourly: 0 })
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data))
  return data as T
}

export const api = {
  providers: () => request<Provider[]>('/providers'),
  jobSearch: (p: JobSearchParams) => {
    const qs = new URLSearchParams({ q: p.q, remote: p.remote ?? 'any', page: String(p.page ?? 1) })
    if (p.location?.trim()) qs.set('location', p.location.trim())
    if (p.sources?.length) qs.set('sources', p.sources.join(','))
    return request<JobSearchResult>(`/jobs/search?${qs}`)
  },
  jobDetail: (source: string, id: string) =>
    request<{ description: string; url: string }>(`/jobs/detail?${new URLSearchParams({ source, id })}`),
  verify: () => request<{ ok: boolean; model: string; demo?: boolean; provider?: string; remaining_hourly?: number | null }>('/providers/verify', { ai: true }),
  parseResume: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<ParsedResume>('/resume/parse', { form })
  },
  profile: (resume: string) => request<Profile>('/resume/profile', { ai: true, body: { resume } }),
  match: (resume: string, job_description: string) =>
    request<MatchResult>('/match', { ai: true, body: { resume, job_description } }),
  cvReview: (resume: string, target_role?: string) =>
    request<CVReview>('/cv/review', { ai: true, body: { resume, target_role: target_role || undefined } }),
  linkedin: (body: { headline: string; about: string; experience?: string }) =>
    request<LinkedInReview>('/linkedin/review', { ai: true, body }),
  careerPath: (body: { resume: string; current_role: string; target_role?: string; location?: string; currency: Currency }) =>
    request<CareerPath>('/career/path', { ai: true, body }),
  questions: (resume: string, job_description: string, count: number) =>
    request<{ questions: InterviewQuestion[] }>('/interview/questions', {
      ai: true,
      body: { resume, job_description, count },
    }),
  feedback: (question: string, answer: string, job_description?: string) =>
    request<InterviewFeedback>('/interview/feedback', {
      ai: true,
      body: { question, answer, job_description: job_description || undefined },
    }),
  coverLetter: (resume: string, job_description: string, tone: CoverLetterTone) =>
    request<{ cover_letter: string }>('/cover-letter', { ai: true, body: { resume, job_description, tone } }),
  importJob: (url: string) => request<ImportedJob>('/jobs/import', { ai: 'optional', body: { url } }),
  atsCheck: (resume: string, job_description: string, meta?: ResumeMeta) =>
    request<AtsResult>('/ats/check', { ai: 'optional', body: { resume, job_description, meta } }),
  salary: (p: { title: string; location?: string; company?: string; currency?: Currency }) => {
    const qs = new URLSearchParams({ title: p.title.trim().slice(0, 100), currency: p.currency ?? 'INR' })
    if (p.location?.trim()) qs.set('location', p.location.trim().slice(0, 80))
    if (p.company?.trim()) qs.set('company', p.company.trim().slice(0, 80))
    return request<SalaryResult>(`/salary?${qs}`)
  },
  /** Live chat models. With no key, only OpenRouter (public list) and Groq in demo mode are listable. */
  models: (provider: string, key: string) =>
    request<ModelList>(`/providers/${encodeURIComponent(provider)}/models`, { headers: key ? { 'X-LLM-Key': key } : {} }),
}

/* ---------- Formatting ---------- */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** '5 yrs 3 mos', '1 yr', '3 mos'. 0 / 0 is 'Less than a month' when the user set it, else empty. */
export function formatExperience(years: number, months: number, explicit = false): string {
  const parts = [years > 0 && plural(years, 'yr', 'yrs'), months > 0 && plural(months, 'mo', 'mos')].filter(Boolean)
  return parts.length ? parts.join(' ') : explicit ? 'Less than a month' : ''
}

export const profileExperience = (p: Profile | null | undefined) =>
  p ? formatExperience(p.experience_years, p.experience_months, p.experience_set) : ''

/** The JD text an imported job fills in: a short header the model can read, then the description. */
export function importedJobText(j: ImportedJob): string {
  const header = [
    j.title,
    [j.company, j.location].filter(Boolean).join(', '),
    j.employment_type && `Employment type: ${j.employment_type}`,
    j.experience_required && `Experience: ${j.experience_required}`,
    j.salary && `Salary: ${j.salary}`,
  ].filter(Boolean)
  return [header.join('\n'), j.description.trim()].filter(Boolean).join('\n\n')
}

/** Wraps an async call with loading and error state. Resolves to undefined on failure. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setLoading(true)
      setError('')
      try {
        return await fn(...args)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
        return undefined
      } finally {
        setLoading(false)
      }
    },
    [fn],
  )
  return { run, loading, error, setError }
}
