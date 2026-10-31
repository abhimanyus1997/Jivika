import { useCallback, useState } from 'react'
import { getCredentials } from './store'

/* ---------- Contract types (mirror the FastAPI schemas) ---------- */

export interface Provider {
  id: string
  name: string
  default_model: string
  key_url: string
}

/** Used until /api/providers responds, and if it cannot be reached. */
export const FALLBACK_PROVIDERS: Provider[] = [
  { id: 'gemini', name: 'Google Gemini', default_model: 'gemini-2.5-flash', key_url: 'https://aistudio.google.com/apikey' },
  { id: 'openai', name: 'OpenAI', default_model: 'gpt-4.1-mini', key_url: 'https://platform.openai.com/api-keys' },
  { id: 'groq', name: 'Groq', default_model: 'llama-3.3-70b-versatile', key_url: 'https://console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', default_model: 'openai/gpt-4.1-mini', key_url: 'https://openrouter.ai/keys' },
]

export interface ParsedResume {
  text: string
  pages: number
  characters: number
}

export interface Profile {
  name: string
  headline: string
  current_role: string
  years_experience: number
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

export interface CareerPath {
  current: { title: string; salary_range: string }
  next: { title: string; salary_range: string; timeframe: string }
  future: { title: string; salary_range: string; timeframe: string }
  skills_to_build: { skill: string; why: string; resource: string }[]
  career_score: number
  rationale: string
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

async function request<T>(path: string, init: { body?: unknown; form?: FormData; ai?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.ai) {
    const { provider, model, key } = getCredentials()
    if (!key) throw new ApiError(401, 'Add your API key in Settings to use this tool.')
    headers['X-LLM-Provider'] = provider
    headers['X-LLM-Key'] = key
    if (model.trim()) headers['X-LLM-Model'] = model.trim()
  }
  let body: BodyInit | undefined
  if (init.form) body = init.form
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const method = body || init.ai ? 'POST' : 'GET'

  let res: Response
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data))
  return data as T
}

export const api = {
  providers: () => request<Provider[]>('/providers'),
  verify: () => request<{ ok: boolean; model: string }>('/providers/verify', { ai: true }),
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
