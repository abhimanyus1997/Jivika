import { ArrowLeft, ArrowRight, Check, ListChecks, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { JobImport } from '../components/JobImport'
import { RequirementMatch } from '../components/RequirementMatch'
import { Button, Card, ErrorMessage, Field, inputCls, KeyNotice, Note, PageHeader, Segmented, SkeletonCard, textareaCls, toast } from '../components/ui'
import { api, applicationApi, importedJobText, useAction, useAiReady, type CoverLetterTone, type StructuredProfile } from '../lib/api'
import {
  keepBasics,
  newId,
  normalizeStructured,
  read,
  syncProfileFromStructured,
  today,
  useApplications,
  useMatches,
  useResume,
  useStructuredProfile,
  write,
  type Application,
  type RequirementResult,
  type StoredResume,
  type TailoredResume,
  type WorkMode,
} from '../lib/store'

/** A job from search, match or a saved list, used to start an application. */
export interface JobSeed {
  title: string
  company: string
  location: string
  url: string
  description: string
  salary?: string
  posted_at?: string
  source?: string
}

const SEED_KEY = 'jivika.newApplicationSeed'
/** In-progress flow, saved when '+ Add to profile' leaves the page and restored on return. */
const DRAFT_KEY = 'jivika.newApplicationDraft'
/** Tailoring takes at most 500 characters of extra instructions. */
const MAX_CONTEXT = 500

/** Opens the new application flow prefilled with a job. */
export function startApplicationFromJob(job: JobSeed) {
  sessionStorage.setItem(SEED_KEY, JSON.stringify(job))
  location.hash = 'new-application'
}

export const WORK_MODES: WorkMode[] = ['On-site', 'Hybrid', 'Remote']
const guessWorkMode = (text: string): WorkMode => (/\bhybrid\b/i.test(text) ? 'Hybrid' : /\bremote\b/i.test(text) ? 'Remote' : '')

/* ---------- Shared with the application page ---------- */

/** Plain-text version of the structured profile, for tools that read resume text. */
export function profileText(p: StructuredProfile): string {
  const b = p.basics
  return [
    [b.name, b.headline, b.location, b.email, b.phone].filter(Boolean).join('\n'),
    b.summary,
    ...p.experience.map((e) =>
      [`${e.title} at ${e.company} (${[e.start, e.current ? 'present' : e.end].filter(Boolean).join(' - ')})`, ...e.bullets.map((x) => `- ${x}`)].join('\n'),
    ),
    ...p.projects.map((x) => [x.name, x.description, ...x.bullets.map((y) => `- ${y}`)].filter(Boolean).join('\n')),
    ...p.education.map((e) => [e.degree, e.field, e.institution, e.end].filter(Boolean).join(', ')),
    p.skills.length ? `Skills: ${p.skills.flatMap((g) => g.items).join(', ')}` : '',
  ]
    .filter((s) => s?.trim())
    .join('\n\n')
}

/** The structured profile, built from the uploaded resume the first time it is needed. */
export async function ensureStructured(): Promise<StructuredProfile> {
  const saved = read<StructuredProfile | null>('structuredProfile', null)
  if (saved) return normalizeStructured(saved)
  const resume = read<StoredResume | null>('resume', null)
  if (!resume?.text) throw new Error('Add your resume on the Profile page first.')
  const p = normalizeStructured(await api.structureProfile(resume.text))
  write('structuredProfile', p)
  syncProfileFromStructured(p)
  return p
}

const patchApp = (id: string, patch: Partial<Application>) =>
  write('applications', read<Application[]>('applications', []).map((a) => (a.id === id ? { ...a, ...patch } : a)))

/** Tailors a resume to the application's posting and links it to the application. */
export async function tailorForApplication(app: Application, context = '') {
  const profile = await ensureStructured()
  const r = await api.tailorResume({ profile, job_description: app.description ?? '', emphasis: context.trim().slice(0, MAX_CONTEXT) || undefined })
  const at = new Date().toISOString()
  const entry: TailoredResume = {
    id: app.id,
    appId: app.id,
    job: { title: app.role, company: app.company, description: app.description ?? '' },
    createdAt: at,
    highlighted_skills: r.highlighted_skills ?? [],
    gaps: r.gaps ?? [],
    versions: [{ resume: keepBasics(r.resume, profile), label: 'Tailored to the job', at, ai: true, changes: r.changes ?? [] }],
    current: 0,
  }
  write('tailoredResumes', { ...read<Record<string, TailoredResume>>('tailoredResumes', {}), [app.id]: entry })
}

/** Writes a cover letter for the application and stores it on the application. */
export async function writeCoverLetterFor(app: Application, tone: CoverLetterTone, context = '') {
  const resume = read<StoredResume | null>('resume', null)?.text || profileText(await ensureStructured())
  // Notes go first so the server's length cap trims the posting, not them.
  const notes = context.trim() ? `Notes from the candidate (follow them, do not quote them):\n${context.trim().slice(0, MAX_CONTEXT)}\n\nJob posting:\n` : ''
  const r = await api.coverLetter({ resume, job_description: notes + (app.description ?? ''), tone, company: app.company.slice(0, 200) || undefined })
  patchApp(app.id, { cover_letter: { text: r.cover_letter, letter: r.letter, tone } })
}

export const COVER_TONES: { value: CoverLetterTone; label: string }[] = [
  { value: 'enthusiastic', label: 'Warm' },
  { value: 'concise', label: 'Direct' },
  { value: 'professional', label: 'Formal' },
]

/* ---------- Page ---------- */

interface Draft {
  company: string
  role: string
  location: string
  work_mode: WorkMode
  salary: string
  deadline: string
  link: string
  description: string
}

const blank: Draft = { company: '', role: '', location: '', work_mode: '', salary: '', deadline: '', link: '', description: '' }
const STEPS = ['The job', 'How you match', 'Tailoring']

function fromSeed(j: Partial<JobSeed>): Draft {
  const head = [j.title, [j.company, j.location].filter(Boolean).join(', ')].filter(Boolean).join('\n')
  return {
    ...blank,
    company: j.company ?? '',
    role: j.title ?? '',
    location: j.location ?? '',
    work_mode: guessWorkMode(j.location ?? ''),
    salary: j.salary ?? '',
    link: j.url ?? '',
    // Postings that already name the role (pasted job descriptions) are used as they are.
    description: [j.title && j.description?.includes(j.title) ? '' : head, j.description ?? ''].filter((s) => s.trim()).join('\n\n'),
  }
}

interface SavedDraft {
  d: Draft
  req: RequirementResult | null
  checkedFor: string
  step: number
  tone: CoverLetterTone
  context: string
}

function readDraft(): SavedDraft | null {
  // A new seed (Start application) wins over an older draft.
  if (sessionStorage.getItem(SEED_KEY)) return null
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    const v = raw ? (JSON.parse(raw) as SavedDraft) : null
    return v && v.d && typeof v.d === 'object' ? { ...v, d: { ...blank, ...v.d } } : null
  } catch {
    return null // a malformed draft just starts over
  }
}

function readSeed(): Draft {
  try {
    const raw = sessionStorage.getItem(SEED_KEY)
    return raw ? fromSeed(JSON.parse(raw) as JobSeed) : blank
  } catch {
    return blank // a malformed seed just leaves the form empty
  }
}

/** Saved jobs from Job search when present, plus Job match top picks. Unknown shapes are skipped. */
function useSavedJobs(): { id: string; label: string; seed: Partial<JobSeed> }[] {
  const [matches] = useMatches()
  const saved = read<unknown>('savedJobs', [])
  // ponytail: reads Job search's saved list by key; switch to its store hook if the shape changes.
  const jobs = (Array.isArray(saved) ? saved : [])
    .map((x) => ((x as { job?: unknown })?.job ?? x) as Partial<JobSeed> & { id?: string; snippet?: string })
    .filter((j) => j && typeof j.title === 'string')
    .map((j, i) => ({ id: `s${j.id ?? i}`, label: `${j.title}${j.company ? ` at ${j.company}` : ''}`, seed: { ...j, description: j.description || j.snippet || '' } }))
  const picks = matches.map((m) => ({
    id: `m${m.id}`,
    label: `${m.result.job_title || 'Role'}${m.result.company ? ` at ${m.result.company}` : ''} (top pick)`,
    seed: { title: m.result.job_title, company: m.result.company, location: m.result.location, description: m.job_description, salary: m.result.salary_range },
  }))
  return [...jobs, ...picks]
}

export default function NewApplication() {
  const [, setApps] = useApplications()
  const [structured] = useStructuredProfile()
  const [resume] = useResume()
  const ready = useAiReady()
  const savedJobs = useSavedJobs()
  const [saved] = useState(readDraft)
  const [step, setStep] = useState(saved?.step ?? 0)
  // Job search and Job match leave a job in sessionStorage before opening this page.
  const [d, setD] = useState<Draft>(() => saved?.d ?? readSeed())
  const [req, setReq] = useState<RequirementResult | null>(saved?.req ?? null)
  const [checkedFor, setCheckedFor] = useState(saved?.checkedFor ?? '')
  const [tone, setTone] = useState<CoverLetterTone>(saved?.tone ?? 'enthusiastic')
  const [context, setContext] = useState(saved?.context ?? '')
  const [creating, setCreating] = useState(false)
  const stepsRef = useRef<HTMLDivElement>(null)
  const firstStep = useRef(true)
  const check = useAction(async (description: string) => applicationApi.requirements(description, await ensureStructured()))
  const hasProfile = !!structured || !!resume?.text

  useEffect(() => {
    sessionStorage.removeItem(SEED_KEY)
    sessionStorage.removeItem(DRAFT_KEY)
  }, [])
  // Move focus to the new step's heading; the button that was focused has unmounted.
  useEffect(() => {
    if (firstStep.current) return void (firstStep.current = false)
    const h = stepsRef.current?.querySelector<HTMLElement>('h2')
    if (h) {
      h.tabIndex = -1
      h.focus()
    }
  }, [step])
  const saveDraft = () => sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ d, req, checkedFor, step, tone, context } satisfies SavedDraft))

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  async function toMatch() {
    setStep(1)
    if (!ready || !hasProfile || checkedFor === d.description) return
    const r = await check.run(d.description)
    if (!r) return
    setReq(r)
    setCheckedFor(d.description)
    // Fill only what the user left empty.
    setD((x) => ({
      ...x,
      company: x.company || r.company || '',
      role: x.role || r.title || '',
      location: x.location || r.location || '',
      work_mode: x.work_mode || r.work_mode || '',
      salary: x.salary || r.salary || '',
      deadline: x.deadline || r.deadline || '',
    }))
  }

  async function create() {
    const t = today()
    const app: Application = {
      id: newId(),
      company: d.company.trim(),
      role: d.role.trim(),
      date: t,
      created: t,
      status: 'Draft',
      link: d.link.trim(),
      notes: '',
      description: d.description.trim(),
      location: d.location.trim(),
      work_mode: d.work_mode,
      salary: d.salary.trim(),
      deadline: d.deadline,
      requirements: req ?? undefined,
      history: [{ status: 'Draft', date: t }],
    }
    setApps((list) => [app, ...list])
    if (ready && hasProfile && app.description) {
      setCreating(true)
      const results = await Promise.allSettled([tailorForApplication(app, context), writeCoverLetterFor(app, tone, context)])
      setCreating(false)
      toast(
        results.every((r) => r.status === 'fulfilled')
          ? 'Application created with a tailored resume and cover letter'
          : 'Application created. Some drafts could not be written; try again on the application page.',
      )
    } else toast('Application created')
    location.hash = `application?id=${app.id}`
  }

  const jobReady = d.description.trim().length >= 30 && !!d.company.trim() && !!d.role.trim()

  return (
    <>
      <PageHeader title="New application" description="Add the job, see how your profile fits, and get a tailored resume and cover letter in one go." />

      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
            <span
              className={`t-num flex size-6 items-center justify-center rounded-full text-[11px] font-medium ${
                i < step ? 'bg-brand-600 text-white' : i === step ? 'border border-brand-500 text-brand-700' : 'border border-line text-faint'
              }`}
              aria-hidden="true"
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium text-ink' : 'text-muted'}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="max-w-3xl [&_h2]:outline-none" ref={stepsRef}>
        {step === 0 && (
          <Card title="The job" description="Paste the posting, import it from a link, or start from a job you saved.">
            {/* Not a form: JobImport has its own. */}
            <div className="space-y-4">
              {savedJobs.length > 0 && (
                <Field label="Start from a saved job">
                  <select
                    className={inputCls}
                    value=""
                    onChange={(e) => {
                      const j = savedJobs.find((x) => x.id === e.target.value)
                      if (j) setD(fromSeed(j.seed))
                    }}
                  >
                    <option value="">Choose a saved job</option>
                    {savedJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <JobImport
                onImport={(_, job) =>
                  setD((x) => ({
                    ...x,
                    company: job.company || x.company,
                    role: job.title || x.role,
                    location: job.location || x.location,
                    work_mode: guessWorkMode(`${job.location} ${job.employment_type}`) || x.work_mode,
                    salary: job.salary || x.salary,
                    link: job.url || x.link,
                    description: importedJobText(job),
                  }))
                }
              />
              <Field label="Job posting">
                <textarea
                  className={`${textareaCls} h-48`}
                  value={d.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Paste the full job posting here."
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <input className={inputCls} value={d.company} onChange={(e) => set('company', e.target.value)} />
                </Field>
                <Field label="Role">
                  <input className={inputCls} value={d.role} onChange={(e) => set('role', e.target.value)} />
                </Field>
                <Field label="Location">
                  <input className={inputCls} value={d.location} onChange={(e) => set('location', e.target.value)} />
                </Field>
                <Field label="Work mode">
                  <select className={inputCls} value={d.work_mode} onChange={(e) => set('work_mode', e.target.value as WorkMode)}>
                    <option value="">Not stated</option>
                    {WORK_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Salary">
                  <input className={inputCls} value={d.salary} onChange={(e) => set('salary', e.target.value)} />
                </Field>
                <Field label="Apply by">
                  <input type="date" className={`${inputCls} t-num`} value={d.deadline} onChange={(e) => set('deadline', e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Job link">
                    <input type="url" className={inputCls} value={d.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
                  </Field>
                </div>
              </div>
              <p className="text-xs text-faint">Empty details are filled from the posting in the next step, where you can still change them.</p>
              <div className="flex justify-end">
                <Button variant="brand" icon={ArrowRight} disabled={d.description.trim().length < 30} onClick={() => void toMatch()}>
                  Continue
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card title="How you match" description="Each requirement from the posting, checked against your profile.">
            <div className="space-y-4">
              <KeyNotice />
              <ErrorMessage message={check.error} />
              {!hasProfile && (
                <Note>
                  Add your resume on the{' '}
                  <a href="#profile" className="font-medium text-ink underline underline-offset-2">
                    Profile
                  </a>{' '}
                  page to see how you match. You can still create the application now.
                </Note>
              )}
              {check.loading ? <SkeletonCard lines={6} label="Checking requirements" /> : req && <RequirementMatch result={req} onAdd={saveDraft} />}
              {req && (
                <Note icon={ListChecks}>
                  Gaps are not dealbreakers. Jivika never invents experience; it can address the important ones honestly in your cover letter.
                </Note>
              )}
              {!check.loading && check.error && (
                <Button size="sm" variant="secondary" onClick={() => void toMatch()}>
                  Try again
                </Button>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company">
                  <input className={inputCls} value={d.company} onChange={(e) => set('company', e.target.value)} />
                </Field>
                <Field label="Role">
                  <input className={inputCls} value={d.role} onChange={(e) => set('role', e.target.value)} />
                </Field>
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="brand" icon={ArrowRight} disabled={check.loading || !d.company.trim() || !d.role.trim()} onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="Tailoring" description="Jivika writes a resume and cover letter for this job using only what is in your profile.">
            <div className="space-y-4">
              <div>
                <span className="t-label mb-1.5 block">Cover letter tone</span>
                <Segmented label="Cover letter tone" options={COVER_TONES} value={tone} onChange={setTone} />
              </div>
              <Field label="Anything Jivika should know?" hint={`${context.length}/${MAX_CONTEXT}`}>
                <textarea
                  className={`${textareaCls} min-h-24`}
                  maxLength={MAX_CONTEXT}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="For example: I am relocating to Pune in March, or lead with my payments work."
                />
              </Field>
              <KeyNotice />
              {!(ready && hasProfile) && <p className="text-xs text-faint">Without a model or a profile the application is saved as a draft. You can tailor it later.</p>}
              <div className="flex justify-between gap-2">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)} disabled={creating}>
                  Back
                </Button>
                <Button variant="brand" icon={Sparkles} loading={creating} disabled={!jobReady} onClick={() => void create()}>
                  Create application
                </Button>
              </div>
            </div>
          </Card>
        )}
        <p className="mt-4 text-xs text-faint">
          Already applied somewhere?{' '}
          <a href="#applications?new" className="font-medium text-brand-600 hover:underline">
            Log it directly
          </a>
          .
        </p>
      </div>
    </>
  )
}
