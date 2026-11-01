import { FileDown, FileText, History, MessageSquareText, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ProfileEditor } from '../components/ProfileEditor'
import { printResume, ResumePaper, ResumePrint, SECTION_TITLES, THEMES } from '../components/ResumeDoc'
import {
  Badge,
  BulletList,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  KeyNotice,
  Modal,
  PageHeader,
  Segmented,
  SkeletonCard,
  textareaCls,
  toast,
} from '../components/ui'
import { api, useAction, useAiReady, type StructuredProfile } from '../lib/api'
import {
  newId,
  normalizeStructured,
  read,
  SECTION_KEYS,
  syncProfileFromStructured,
  useResume,
  useResumeSettings,
  useStructuredProfile,
  useTailoredResumes,
  write,
  type ResumeVersion,
  type TailoredResume,
} from '../lib/store'

/** Left by Job match or an application before linking to #resume?tailor=new. */
export interface TailorRequest {
  appId?: string
  job: { title: string; company: string; description: string }
}

export function requestTailor(req: TailorRequest) {
  write('tailorRequest', req)
  location.hash = 'resume?tailor=new'
}

const MAX_VERSIONS = 20
const ACCENTS = ['#1f7a4d', '#1c1b19', '#3b5ba9', '#7a3b69', '#9a6403', '#b42318']

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const useTailorParam = () => useSyncExternalStore(subscribeHash, () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('tailor') ?? '')

const jobLabel = (t: TailoredResume) => [t.job.company, t.job.title].filter(Boolean).join(' - ') || 'Untitled job'
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function DesignCard({ company, name }: { company?: string; name: string }) {
  const [settings, setSettings] = useResumeSettings()
  const toggles = ['summary', ...settings.order]
  return (
    <Card
      title="Design"
      action={
        <Button size="sm" variant="brand" icon={FileDown} onClick={() => {
          toast('Choose "Save as PDF" as the destination to download the resume.')
          printResume(name, company)
        }}>
          Download PDF
        </Button>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="t-label mb-1.5 block">Theme</legend>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => {
              const active = settings.theme === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSettings({ ...settings, theme: t.value })}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ${
                    active ? 'border-brand-500 bg-brand-50/60' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                  <span className="block text-[11px] leading-4 text-muted">{t.hint}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="t-label mb-1.5 block">Accent color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Accent ${c}`}
                aria-pressed={settings.accent.toLowerCase() === c}
                onClick={() => setSettings({ ...settings, accent: c })}
                className={`size-6 rounded-full ring-offset-2 ring-offset-surface ${settings.accent.toLowerCase() === c ? 'ring-2 ring-ink' : 'ring-1 ring-line'}`}
                style={{ background: c }}
              />
            ))}
            <label className="ml-1 inline-flex items-center gap-1.5 text-[13px] text-muted">
              <input
                type="color"
                className="size-7 cursor-pointer rounded border border-line bg-surface p-0.5"
                value={settings.accent}
                onChange={(e) => setSettings({ ...settings, accent: e.target.value })}
              />
              Custom
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend className="t-label mb-1.5 block">Sections shown</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {toggles.map((k) => (
              <label key={k} className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  checked={!settings.hidden.includes(k)}
                  onChange={(e) =>
                    setSettings({ ...settings, hidden: e.target.checked ? settings.hidden.filter((x) => x !== k) : [...settings.hidden, k] })
                  }
                />
                {SECTION_TITLES[k as keyof typeof SECTION_TITLES]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">
            Change the section order on the{' '}
            <a href="#profile" className="text-brand-600 hover:underline">
              Profile
            </a>{' '}
            page.
          </p>
        </fieldset>
      </div>
    </Card>
  )
}

function TailoredPanel({ t, onChange, source }: { t: TailoredResume; onChange: (t: TailoredResume) => void; source: StructuredProfile | null }) {
  const [instruction, setInstruction] = useState('')
  const [section, setSection] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [, setAll] = useTailoredResumes()
  const key = useAiReady()
  const refine = useAction(api.refineResume)
  const version = t.versions[t.current]
  const last = t.versions.at(-1)
  const canUndo = t.versions.length > 1 && !!last?.ai

  async function runRefine() {
    const text = instruction.trim()
    if (!text) return
    const r = await refine.run({ resume: version.resume, source_profile: source ?? t.versions[0].resume, instruction: text, section: section || undefined })
    if (!r) return
    const v: ResumeVersion = { resume: normalizeStructured(r.resume), label: text, at: new Date().toISOString(), ai: true, changes: r.changes ?? [] }
    const versions = [...t.versions, v].slice(-MAX_VERSIONS)
    onChange({ ...t, versions, current: versions.length - 1 })
    setInstruction('')
    toast('Resume refined')
  }

  return (
    <>
      <Card title="Tailored for" description={jobLabel(t)} divider>
        <div className="space-y-5">
          <div>
            <h3 className="t-overline mb-2">Highlighted skills</h3>
            {t.highlighted_skills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {t.highlighted_skills.map((s) => (
                  <Badge key={s} tone="brand">
                    {s}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted">None listed.</p>
            )}
          </div>
          <div>
            <h3 className="t-overline mb-1">Not in your profile</h3>
            <p className="mb-2 text-xs text-faint">The job asks for these. They are not added to your resume; add them to your profile only if they are true.</p>
            {t.gaps.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {t.gaps.map((g, i) => (
                  <li key={i} className="rounded-lg border border-line px-3 py-2">
                    <span className="font-medium text-ink">{g.requirement}</span>
                    {g.note && <span className="block text-muted">{g.note}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No gaps found.</p>
            )}
          </div>
          <div>
            <h3 className="t-overline mb-2">Changes in this version</h3>
            <BulletList items={version.changes} empty="No changes listed." />
          </div>
        </div>
      </Card>

      <Card title="Refine" description="Ask for a change. Facts stay grounded in your profile.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void runRefine()
          }}
        >
          <Field label="Instruction">
            <textarea
              className={`${textareaCls} min-h-20`}
              value={instruction}
              maxLength={500}
              placeholder="e.g. Shorten the summary to two sentences and lead with leadership experience."
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void runRefine()
                }
              }}
            />
          </Field>
          <Field label="Section">
            <select className={inputCls} value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">Whole resume</option>
              {['summary', ...SECTION_KEYS].map((k) => (
                <option key={k} value={k}>
                  {SECTION_TITLES[k as keyof typeof SECTION_TITLES]}
                </option>
              ))}
            </select>
          </Field>
          <KeyNotice />
          <ErrorMessage message={refine.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="brand" icon={MessageSquareText} loading={refine.loading} disabled={!key || !instruction.trim()}>
              Refine
            </Button>
            <Button
              variant="secondary"
              icon={Undo2}
              disabled={!canUndo}
              onClick={() => {
                const versions = t.versions.slice(0, -1)
                onChange({ ...t, versions, current: Math.min(t.current, versions.length - 1) })
                toast('Last AI change undone')
              }}
            >
              Undo last AI change
            </Button>
          </div>
        </form>
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
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onChange({ ...t, current: i })} aria-label={`Restore version ${i + 1}: ${v.label}`}>
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ol>
        <div className="border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" icon={Trash2} className="hover:text-danger" onClick={() => setConfirmDelete(true)}>
            Delete tailored resume
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete tailored resume?"
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
                setAll((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== t.id)))
                setConfirmDelete(false)
                location.hash = 'resume'
                toast('Tailored resume deleted')
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">All versions of the resume for {jobLabel(t)} will be removed. Your profile is not affected.</p>
      </Modal>
    </>
  )
}

export default function ResumePage() {
  const [resume] = useResume()
  const [structured, setStructured] = useStructuredProfile()
  const [settings] = useResumeSettings()
  const [all, setAll] = useTailoredResumes()
  const param = useTailorParam()
  // The view resets to Preview when another resume is selected.
  const [view, setView] = useState<{ param: string; mode: 'preview' | 'edit' }>({ param, mode: 'preview' })
  const mode = view.param === param ? view.mode : 'preview'
  const setMode = (m: 'preview' | 'edit') => setView({ param, mode: m })
  const tailored = param && param !== 'new' ? all[param] : undefined

  const tailor = useAction(async (req: TailorRequest) => {
    let profile = structured
    if (!profile) {
      if (!resume?.text) throw new Error('Upload your resume on the Profile page first.')
      profile = normalizeStructured(await api.structureProfile(resume.text))
      setStructured(profile)
      syncProfileFromStructured(profile)
    }
    const r = await api.tailorResume({ profile, job_description: req.job.description })
    const id = req.appId ?? newId()
    const entry: TailoredResume = {
      id,
      appId: req.appId,
      job: req.job,
      createdAt: new Date().toISOString(),
      highlighted_skills: r.highlighted_skills ?? [],
      gaps: r.gaps ?? [],
      versions: [{ resume: normalizeStructured(r.resume), label: 'Tailored to the job', at: new Date().toISOString(), ai: true, changes: r.changes ?? [] }],
      current: 0,
    }
    setAll((a) => ({ ...a, [id]: entry }))
    return id
  })
  const [pending, setPending] = useState<TailorRequest | null>(null)

  // #resume?tailor=new runs the request Job match or Applications left behind.
  useEffect(() => {
    if (param !== 'new') return
    const req = read<TailorRequest | null>('tailorRequest', null)
    write('tailorRequest', null)
    history.replaceState(null, '', '#resume')
    dispatchEvent(new HashChangeEvent('hashchange'))
    if (!req?.job?.description) return
    setPending(req)
    tailor.run(req).then((id) => {
      setPending(null)
      if (id) {
        location.hash = `resume?tailor=${id}`
        toast('Tailored resume ready')
      }
    })
  }, [param])

  const updateTailored = (t: TailoredResume) => setAll((a) => ({ ...a, [t.id]: t }))
  const shown = tailored ? tailored.versions[tailored.current]?.resume : structured
  const options = Object.values(all).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  function editShown(next: StructuredProfile) {
    if (!tailored) return setStructured(next)
    updateTailored({
      ...tailored,
      versions: tailored.versions.map((v, i) => (i === tailored.current ? { ...v, resume: next } : v)),
    })
  }

  return (
    <>
      <PageHeader
        title="Resume"
        description="Your resume, rendered from your structured profile. Pick a theme, tailor it to a job, and download an A4 PDF."
        actions={
          options.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <span>Showing</span>
              <select
                className={`${inputCls} w-64`}
                value={tailored?.id ?? ''}
                onChange={(e) => (location.hash = e.target.value ? `resume?tailor=${e.target.value}` : 'resume')}
              >
                <option value="">Base resume</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tailored: {jobLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />

      <ErrorMessage message={tailor.error} />
      {param && param !== 'new' && !tailored && (
        <ErrorMessage message="That tailored resume was not found in this browser. It may have been deleted." />
      )}

      {tailor.loading ? (
        <SkeletonCard lines={8} label={`Tailoring resume for ${pending ? [pending.job.company, pending.job.title].filter(Boolean).join(' - ') : 'the job'}`} />
      ) : !shown ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="No structured profile yet"
            text="Build a structured profile from your resume on the Profile page. Your resume is rendered from it."
            action={
              <ButtonLink href="#profile" variant="brand" icon={Sparkles} size="sm">
                Go to Profile
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <ResumePrint profile={shown} settings={settings} />
          <div className="space-y-6">
            {tailored && <TailoredPanel key={tailored.id} t={tailored} onChange={updateTailored} source={structured} />}
            <DesignCard name={shown.basics.name} company={tailored?.job.company} />
          </div>
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Resume view"
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'preview', label: 'Preview' },
                  { value: 'edit', label: 'Edit content' },
                ]}
              />
              <span className="text-xs text-faint">
                {tailored ? 'Edits apply to the version shown.' : 'Edits update your structured profile.'}
              </span>
            </div>
            {mode === 'edit' ? (
              <ProfileEditor value={shown} onChange={editShown} order={settings.order} />
            ) : (
              <div className="rounded-xl border border-line bg-subtle p-3 md:p-6">
                <ResumePaper profile={shown} settings={settings} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
