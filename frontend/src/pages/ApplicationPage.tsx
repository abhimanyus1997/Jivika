import { ArrowLeft, Copy, ExternalLink, FileDown, FileUser, History, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { EmailPanel, formatDate, safeLink, StatusTimeline } from '../components/ApplicationDetail'
import { ProfileEditor } from '../components/ProfileEditor'
import { RequirementMatch } from '../components/RequirementMatch'
import { printResume, ResumePaper, ResumePrint, SECTION_TITLES } from '../components/ResumeDoc'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  inputCls,
  KeyNotice,
  Modal,
  Note,
  Segmented,
  textareaCls,
  toast,
} from '../components/ui'
import { calendarYears, nextWorkingDay, offReason, useOffDays } from '../lib/holidays'
import { api, applicationApi, useAction, useAiReady, type CoverLetterTone, type ResumeSection, type StructuredProfile } from '../lib/api'
import {
  keepBasics,
  newId,
  placeParts,
  read,
  STATUSES,
  tailoredFor,
  today,
  useApplications,
  useResumeSettings,
  useStructuredProfile,
  useTailoredResumes,
  withStatus,
  write,
  type Application,
  type CoverLetterState,
  type RequirementResult,
  type Status,
  type TailoredResume,
  type WorkMode,
} from '../lib/store'
import { COVER_TONES, ensureStructured, tailorForApplication, WORK_MODES, writeCoverLetterFor } from './NewApplication'

const TABS = [
  { value: 'resume', label: 'Resume' },
  { value: 'cover-letter', label: 'Cover letter' },
  { value: 'email', label: 'Email' },
  { value: 'posting', label: 'Job posting' },
  { value: 'interviews', label: 'Interviews and follow-ups' },
  { value: 'notes', label: 'Notes' },
] as const
type Tab = (typeof TABS)[number]['value']

const MAX_VERSIONS = 20

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const useHashParams = () => useSyncExternalStore(subscribeHash, () => location.hash.split('?')[1] ?? '')

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Refine ideas built from the job title and the requirements the profile shows least. */
function suggestions(a: Application): string[] {
  const reqs = a.requirements?.requirements ?? []
  const top = reqs.find((r) => r.kind === 'required' && r.status === 'met') ?? reqs.find((r) => r.status === 'met')
  const partial = reqs.find((r) => r.status === 'partial')
  // Lowercase the first word of a phrase; single names (Python) and acronyms (SQL) keep their case.
  const lower = (s: string) => (/^[A-Z][a-z]+\s/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
  const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40).trimEnd()}...` : s)
  return [
    'Make the summary shorter',
    top && `Emphasize ${short(top.text)}`,
    partial && `Bring out any ${lower(short(partial.text))} work already in my profile`,
    a.role && `Lead with the experience most relevant to ${short(a.role)}`,
    'Keep each bullet to one line',
  ].filter((s): s is string => !!s).slice(0, 5)
}

function sectionsOf(r: StructuredProfile): { id: ResumeSection; label: string }[] {
  return [
    { id: 'summary' as ResumeSection, label: 'Summary' },
    ...r.experience.map((e) => ({ id: `experience:${e.id}` as ResumeSection, label: [e.title, e.company].filter(Boolean).join(', ') || 'Experience entry' })),
    ...r.projects.map((p) => ({ id: `projects:${p.id}` as ResumeSection, label: p.name || 'Project' })),
    ...(r.skills.length ? [{ id: 'skills' as ResumeSection, label: SECTION_TITLES.skills }] : []),
    ...(r.education.length ? [{ id: 'education' as ResumeSection, label: SECTION_TITLES.education }] : []),
  ]
}

function ResumeTab({ a }: { a: Application }) {
  const [all, setAll] = useTailoredResumes()
  const [structured] = useStructuredProfile()
  const [settings] = useResumeSettings()
  const ready = useAiReady()
  const [instruction, setInstruction] = useState('')
  const [editing, setEditing] = useState(false)
  const [busySection, setBusySection] = useState('')
  const tailor = useAction(tailorForApplication)
  const refine = useAction(api.refineResume)
  const regen = useAction(applicationApi.regenerateSection)
  const t = tailoredFor(all, a.id)
  const description = a.description ?? ''

  if (!t) {
    return (
      <Card>
        <EmptyState
          icon={<FileUser />}
          title="No tailored resume yet"
          text={description.trim().length < 30 ? 'Add the job posting on the Job posting tab, then tailor a resume to it.' : 'Jivika reorders and rewords your profile for this job. Nothing is invented.'}
          action={
            <div className="space-y-2">
              <KeyNotice />
              <ErrorMessage message={tailor.error} />
              <Button variant="brand" icon={FileUser} loading={tailor.loading} disabled={!ready || description.trim().length < 30} onClick={() => void tailor.run(a)}>
                Tailor resume
              </Button>
            </div>
          }
        />
      </Card>
    )
  }

  const version = t.versions[t.current]
  const source = structured ?? t.versions[0].resume
  const save = (next: TailoredResume) => setAll((x) => ({ ...x, [next.id]: next }))
  const push = (resume: StructuredProfile, label: string, changes: string[]) => {
    const versions = [...t.versions, { resume: keepBasics(resume, version.resume), label, at: new Date().toISOString(), ai: true, changes }].slice(-MAX_VERSIONS)
    save({ ...t, versions, current: versions.length - 1 })
  }

  async function runRefine(text: string) {
    if (!text.trim()) return
    const r = await refine.run({ resume: version.resume, source_profile: source, instruction: text.trim() })
    if (!r) return
    push(r.resume, text.trim(), r.changes ?? [])
    setInstruction('')
    toast('Resume refined')
  }

  async function regenerate(section: ResumeSection, label: string) {
    setBusySection(section)
    const r = await regen.run({ resume: version.resume, source_profile: source, section, instruction: instruction.trim() || undefined, job_description: t!.job.description })
    setBusySection('')
    if (r) {
      push(r.resume, `Regenerated ${label}`, r.changes ?? [])
      toast(`${label} regenerated`)
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-faint">
            Version {t.current + 1} of {t.versions.length}: {version.label}
          </span>
          <Button size="sm" variant="secondary" icon={Pencil} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done editing' : 'Edit content'}
          </Button>
        </div>
        {editing ? (
          <ProfileEditor
            value={version.resume}
            onChange={(next) => save({ ...t, versions: t.versions.map((v, i) => (i === t.current ? { ...v, resume: next } : v)) })}
            order={settings.order}
          />
        ) : (
          <div className="rounded-xl border border-line bg-subtle p-3 md:p-6">
            <ResumePaper profile={version.resume} settings={settings} />
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Card title="Refine" description="Ask for a change, or pick an idea.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void runRefine(instruction)
            }}
          >
            <div className="flex flex-wrap gap-1.5">
              {suggestions(a).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!ready || refine.loading}
                  onClick={() => void runRefine(s)}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-xs text-ink hover:border-brand-500 hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:text-faint"
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              aria-label="Instruction"
              className={`${textareaCls} min-h-20`}
              maxLength={500}
              value={instruction}
              placeholder="For example: Put the platform migration first."
              onChange={(e) => setInstruction(e.target.value)}
            />
            <p className="text-xs text-faint">Only facts from your profile are used.</p>
            <KeyNotice />
            <ErrorMessage message={refine.error || regen.error} />
            <Button type="submit" size="sm" variant="brand" loading={refine.loading} disabled={!ready || !instruction.trim()}>
              Refine
            </Button>
          </form>
        </Card>

        <Card title="Sections" description="Regenerate one part. The instruction above is used when filled in." padding={false} divider>
          <ul className="divide-y divide-line">
            {sectionsOf(version.resume).map((s) => (
              <li key={s.id} className="group flex items-center gap-2 px-5 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={s.label}>
                  {s.label}
                </span>
                <span className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RefreshCw}
                    loading={busySection === s.id}
                    disabled={!ready || !!busySection}
                    onClick={() => void regenerate(s.id, s.label)}
                    aria-label={`Regenerate ${s.label}`}
                  >
                    Regenerate
                  </Button>
                  <IconButton icon={Pencil} size="sm" label={`Edit ${s.label}`} onClick={() => setEditing(true)} />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Versions" description="Every version is kept. Restore any of them." padding={false} divider>
          <ol className="divide-y divide-line">
            {t.versions.map((v, i) => (
              <li key={v.at + i} className="flex items-start gap-3 px-5 py-2.5">
                <History className="mt-1 size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] text-ink" title={v.label}>
                    {v.label}
                  </p>
                  <p className="t-num text-[11px] text-faint">{when(v.at)}</p>
                </div>
                {i === t.current ? (
                  <Badge tone="brand">Showing</Badge>
                ) : (
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => save({ ...t, current: i })} aria-label={`Restore version ${i + 1}: ${v.label}`}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <div className="border-t border-line px-5 py-3">
            <ButtonLink href={`#resume?tailor=${t.id}`} size="sm" variant="ghost">
              Open in Resume for themes and layout
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  )
}

function CoverLetterTab({ a, update }: { a: Application; update: (p: Partial<Application>) => void }) {
  const ready = useAiReady()
  const [tone, setTone] = useState<CoverLetterTone>(a.cover_letter?.tone ?? 'enthusiastic')
  const write_ = useAction(writeCoverLetterFor)
  const cl = a.cover_letter
  const hasJob = (a.description ?? '').trim().length >= 30

  function openEditor() {
    if (a.description?.trim()) write('jd', a.description)
    const prev = read<CoverLetterState>('coverLetter', { tone: 'professional', text: '' })
    write('coverLetter', {
      ...prev,
      tone: cl?.tone ?? tone,
      text: cl?.text ?? '',
      parts: cl?.letter,
      recipient: { name: prev.recipient?.name ?? '', title: prev.recipient?.title ?? '', company: a.company },
    })
    location.hash = 'cover-letter'
  }

  return (
    <Card
      title="Cover letter"
      description="Saved with this application."
      action={
        <Button size="sm" variant="secondary" icon={ExternalLink} onClick={openEditor}>
          Open in cover letter editor
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Cover letter tone" size="sm" options={COVER_TONES} value={tone} onChange={setTone} />
          <Button size="sm" variant={cl ? 'ghost' : 'brand'} icon={Mail} loading={write_.loading} disabled={!ready || !hasJob} onClick={() => void write_.run(a, tone)}>
            {cl ? 'Write again' : 'Write cover letter'}
          </Button>
        </div>
        <KeyNotice />
        <ErrorMessage message={write_.error} />
        {!hasJob && <p className="text-xs text-faint">Add the job posting on the Job posting tab first.</p>}
        {cl && (
          <>
            <textarea
              aria-label="Cover letter"
              className={`${textareaCls} field-sizing-content min-h-64`}
              value={cl.text}
              // Edited text replaces the structured letter, which the editor rebuilds from the text.
              onChange={(e) => update({ cover_letter: { ...cl, text: e.target.value, letter: undefined } })}
            />
            <CopyButton text={cl.text} label="Copy cover letter" />
          </>
        )}
      </div>
    </Card>
  )
}

function PostingTab({ a, update }: { a: Application; update: (p: Partial<Application>) => void }) {
  const ready = useAiReady()
  const check = useAction(async (d: string) => applicationApi.requirements(d, await ensureStructured()))
  const description = a.description ?? ''
  async function run() {
    const r = await check.run(description)
    if (r) update({ requirements: r })
  }
  const field = (label: string, k: 'company' | 'role' | 'location' | 'salary' | 'link', type = 'text') => (
    <Field label={label}>
      <input type={type} className={inputCls} value={(a[k] as string) ?? ''} onChange={(e) => update({ [k]: e.target.value })} />
    </Field>
  )
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Details">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('Company', 'company')}
            {field('Role', 'role')}
            {field('Location', 'location')}
            <Field label="Work mode">
              <select className={inputCls} value={a.work_mode ?? ''} onChange={(e) => update({ work_mode: e.target.value as WorkMode })}>
                <option value="">Not stated</option>
                {WORK_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            {field('Salary', 'salary')}
            <Field label="Apply by">
              <input type="date" className={`${inputCls} t-num`} value={a.deadline ?? ''} onChange={(e) => update({ deadline: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">{field('Job link', 'link', 'url')}</div>
          </div>
          <Field label="Job posting">
            <textarea
              className={`${textareaCls} min-h-64`}
              value={description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Paste the job posting to tailor a resume, write a cover letter or draft an email."
            />
          </Field>
        </div>
      </Card>
      <Card
        title="Requirements"
        action={
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={check.loading} disabled={!ready || description.trim().length < 30} onClick={() => void run()}>
            {a.requirements ? 'Check again' : 'Check requirements'}
          </Button>
        }
      >
        <div className="space-y-3">
          <KeyNotice />
          <ErrorMessage message={check.error} />
          {a.requirements ? <RequirementMatch result={a.requirements} /> : <p className="text-[13px] text-muted">See which of the posting's requirements your profile shows.</p>}
        </div>
      </Card>
    </div>
  )
}

function ScheduleTab({ a, update }: { a: Application; update: (p: Partial<Application>) => void }) {
  const interviews = a.interviews ?? []
  const followups = a.followups ?? []
  const setI = (id: string, patch: object) => update({ interviews: interviews.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const setF = (id: string, patch: object) => update({ followups: followups.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const { off } = useOffDays(calendarYears(today()))
  const clash = (date: string) => {
    const why = date && offReason(date, off)
    return why ? <Note tone="warning">This date falls on {why}. Check that the employer is working that day.</Note> : null
  }
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Card
        title="Interviews"
        description="Shown on your calendar."
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => update({ interviews: [...interviews, { id: newId(), date: today(), time: '10:00', duration_min: 45, title: 'Interview', notes: '' }] })}
          >
            Add interview
          </Button>
        }
      >
        {interviews.length ? (
          <ul className="space-y-3">
            {interviews.map((x) => (
              <li key={x.id} className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="Title">
                      <input className={inputCls} value={x.title} onChange={(e) => setI(x.id, { title: e.target.value })} />
                    </Field>
                  </div>
                  <IconButton icon={Trash2} size="sm" label={`Remove ${x.title || 'interview'}`} onClick={() => update({ interviews: interviews.filter((y) => y.id !== x.id) })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Date">
                    <input type="date" className={`${inputCls} t-num`} value={x.date} onChange={(e) => setI(x.id, { date: e.target.value })} />
                  </Field>
                  <Field label="Time">
                    <input type="time" className={`${inputCls} t-num`} value={x.time} onChange={(e) => setI(x.id, { time: e.target.value })} />
                  </Field>
                  <Field label="Minutes">
                    <input
                      type="number"
                      min={5}
                      max={600}
                      step={5}
                      className={`${inputCls} t-num`}
                      value={x.duration_min}
                      onChange={(e) => setI(x.id, { duration_min: Math.max(5, Number(e.target.value) || 0) })}
                    />
                  </Field>
                </div>
                {clash(x.date)}
                <Field label="Notes">
                  <textarea className={`${textareaCls} field-sizing-content min-h-12`} value={x.notes} onChange={(e) => setI(x.id, { notes: e.target.value })} placeholder="Who you meet, the link, what to prepare." />
                </Field>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No interviews yet.</p>
        )}
      </Card>
      <Card
        title="Follow-ups"
        description="Reminders to check in."
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => update({ followups: [...followups, { id: newId(), date: nextWorkingDay(today(), off), note: '', done: false }] })}>
            Add follow-up
          </Button>
        }
      >
        {followups.length ? (
          <ul className="space-y-2">
            {followups.map((x) => (
              <li key={x.id} className="grid grid-cols-[auto_9.5rem_minmax(0,1fr)_auto] items-center gap-2">
                <input type="checkbox" className="size-4 accent-brand-600" checked={x.done} aria-label={`Done: ${x.note || 'follow-up'}`} onChange={(e) => setF(x.id, { done: e.target.checked })} />
                <input type="date" aria-label="Follow-up date" className={`${inputCls} t-num`} value={x.date} onChange={(e) => setF(x.id, { date: e.target.value })} />
                <input aria-label="Follow-up note" className={`${inputCls} ${x.done ? 'text-faint line-through' : ''}`} value={x.note} placeholder="Check in with the recruiter" onChange={(e) => setF(x.id, { note: e.target.value })} />
                <IconButton icon={Trash2} size="sm" label="Remove follow-up" onClick={() => update({ followups: followups.filter((y) => y.id !== x.id) })} />
                {!x.done && offReason(x.date, off) && <div className="col-span-4">{clash(x.date)}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No follow-ups yet.</p>
        )}
      </Card>
    </div>
  )
}

function Meta({ a }: { a: Application }) {
  const items: ReactNode[] = [
    ...placeParts(a.location, a.work_mode),
    a.salary,
    a.deadline && `Apply by ${formatDate(a.deadline, { day: 'numeric', month: 'short' })}`,
    `Created ${formatDate(a.created ?? a.date)}`,
    a.sent && `Sent ${formatDate(a.sent)}`,
  ].filter(Boolean)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
      {items.map((x, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          {x}
        </span>
      ))}
      {a.link && (
        <a href={safeLink(a.link)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
          Job posting <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        </a>
      )}
    </p>
  )
}

export default function ApplicationPage() {
  const params = new URLSearchParams(useHashParams())
  const id = params.get('id') ?? ''
  const tabParam = params.get('tab') as Tab | null
  const [apps, setApps] = useApplications()
  const [all] = useTailoredResumes()
  const [settings] = useResumeSettings()
  const [tabState, setTabState] = useState<{ id: string; tab: Tab }>({ id: '', tab: 'resume' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const closeMenu = (focus = false) => {
    if (!menuRef.current) return
    menuRef.current.open = false
    if (focus) menuRef.current.querySelector('summary')?.focus()
  }
  useEffect(() => {
    const outside = (e: PointerEvent) => menuRef.current?.open && !menuRef.current.contains(e.target as Node) && closeMenu()
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  const a = apps.find((x) => x.id === id)
  const tab = tabState.id === id ? tabState.tab : TABS.some((t) => t.value === tabParam) ? tabParam! : 'resume'
  const setTab = (t: Tab) => setTabState({ id, tab: t })

  if (!a) {
    return (
      <Card>
        <EmptyState
          icon={<FileUser />}
          title="Application not found"
          text="It may have been deleted, or it was saved in another browser."
          action={
            <ButtonLink href="#applications" icon={ArrowLeft}>
              Back to applications
            </ButtonLink>
          }
        />
      </Card>
    )
  }

  const update = (patch: Partial<Application> | ((x: Application) => Application)) =>
    setApps((list) => list.map((x) => (x.id === id ? (typeof patch === 'function' ? patch(x) : { ...x, ...patch }) : x)))
  const t = tailoredFor(all, a.id)
  const shown = t?.versions[t.current]?.resume

  function duplicate() {
    const copy: Application = {
      ...a!,
      id: newId(),
      role: `${a!.role} (copy)`,
      status: 'Draft',
      date: today(),
      created: today(),
      sent: undefined,
      email: undefined,
      interviews: undefined,
      followups: undefined,
      history: [{ status: 'Draft', date: today() }],
    }
    setApps((list) => [copy, ...list])
    closeMenu()
    toast('Application duplicated')
    location.hash = `application?id=${copy.id}`
  }

  return (
    <>
      <div>
      <a href="#applications" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Applications
      </a>
      <header className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="t-page-title">
            {a.role || 'Role'} <span className="text-muted">·</span> {a.company || 'Company'}
          </h1>
          <Meta a={a} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <span className="sr-only">Status</span>
            <select className={`${inputCls} w-36`} value={a.status} onChange={(e) => update((x) => withStatus(x, e.target.value as Status))}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {a.status === 'Draft' && (
            <Button
              variant="brand"
              icon={Send}
              onClick={() => {
                update((x) => withStatus(x, 'Applied'))
                toast('Marked as sent')
              }}
            >
              Mark as sent
            </Button>
          )}
          {shown && (
            <Button
              variant="secondary"
              icon={FileDown}
              onClick={() => {
                toast('Choose "Save as PDF" as the destination to download the resume.')
                printResume(shown.basics.name, a.company)
              }}
            >
              Download PDF
            </Button>
          )}
          <details
            ref={menuRef}
            className="relative"
            onKeyDown={(e) => e.key === 'Escape' && closeMenu(true)}
          >
            <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink [&::-webkit-details-marker]:hidden" aria-label="More actions">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-line bg-surface p-1 shadow-pop">
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle" onClick={duplicate}>
                <Copy className="size-4" strokeWidth={1.75} aria-hidden="true" /> Duplicate
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-danger hover:bg-danger-bg"
                onClick={() => {
                  closeMenu()
                  setConfirmDelete(true)
                }}
              >
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" /> Delete
              </button>
            </div>
          </details>
        </div>
      </header>
      </div>

      {shown && <ResumePrint profile={shown} settings={settings} />}

      <div className="space-y-5">
        <Segmented label="Application sections" value={tab} onChange={setTab} options={TABS} />
        {tab === 'resume' && <ResumeTab a={a} />}
        {tab === 'cover-letter' && <CoverLetterTab key={a.id} a={a} update={update} />}
        {tab === 'email' && (
          <Card title="Email draft" description="A short note to send with your application.">
            <EmailPanel app={a} description={a.description ?? ''} update={update} />
          </Card>
        )}
        {tab === 'posting' && <PostingTab a={a} update={update} />}
        {tab === 'interviews' && <ScheduleTab a={a} update={update} />}
        {tab === 'notes' && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card title="Notes">
              <textarea
                aria-label="Notes"
                className={`${textareaCls} field-sizing-content min-h-40`}
                value={a.notes}
                onChange={(e) => update({ notes: e.target.value })}
                placeholder="Contacts, what you learned, anything to remember."
              />
            </Card>
            <Card title="Status history">
              <StatusTimeline app={a} />
            </Card>
          </div>
        )}
        {tab === 'resume' && a.requirements && <RequirementsNote r={a.requirements} />}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete application"
        width="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                setApps((list) => list.filter((x) => x.id !== id))
                setConfirmDelete(false)
                toast('Application deleted')
                location.hash = 'applications'
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Delete the application for {a.role || 'this role'} at {a.company || 'this company'}? This cannot be undone.
        </p>
      </Modal>
    </>
  )
}

function RequirementsNote({ r }: { r: RequirementResult }) {
  if (!r.summary.missing) return null
  return (
    <Note>
      Your profile shows {r.summary.met} of {r.summary.total} requirements. The rest are not added to your resume; add them to your profile only if they are true.
    </Note>
  )
}
