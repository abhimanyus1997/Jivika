import { CopyPlus, FileDown, FileText, History, MessageSquareText, RotateCcw, Sparkles, Trash2, Undo2, Upload, UserRoundPen } from 'lucide-react'
import { memo, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { ExportMenu } from '../components/ExportMenu'
import { ProfileEditor } from '../components/ProfileEditor'
import { printResume, ResumePaper, ResumePrint, ResumeThumb, SECTION_TITLES } from '../components/ResumeDoc'
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
  allThemes,
  DEFAULT_ACCENT,
  FONTS,
  HEADERS,
  HEADINGS,
  isCustomized,
  parseThemeFile,
  resolveTheme,
  themeFile,
  useDesignSettings,
  type FontPair,
  type HeaderStyle,
  type HeadingStyle,
  type ResumeDesign,
  type ThemeDef,
} from '../lib/resume-themes'
import {
  keepBasics,
  newId,
  normalizeStructured,
  read,
  SECTION_KEYS,
  syncProfileFromStructured,
  useResume,
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

/** Gallery thumbnail that skips re-rendering on Customize changes; with a design given it only reads these settings. */
const ThemeThumb = memo(
  (props: ComponentProps<typeof ResumeThumb>) => <ResumeThumb {...props} />,
  (a, b) =>
    a.profile === b.profile &&
    a.design === b.design &&
    a.settings.accent === b.settings.accent &&
    a.settings.order === b.settings.order &&
    a.settings.hidden === b.settings.hidden,
)
const ACCENTS = ['#1f7a4d', '#1c1b19', '#3b5ba9', '#7a3b69', '#9a6403', '#b42318']

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const useTailorParam = () => useSyncExternalStore(subscribeHash, () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('tailor') ?? '')

const jobLabel = (t: TailoredResume) => [t.job.company, t.job.title].filter(Boolean).join(' - ') || 'Untitled job'
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
const fileName = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}.jivika-theme.json`

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="t-label mb-1 flex justify-between">
        {label}
        <span className="t-num text-muted">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" className="w-full accent-brand-600" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function ThemeGallery({ profile }: { profile: StructuredProfile }) {
  const [settings, setSettings] = useDesignSettings()
  const importRef = useRef<HTMLInputElement>(null)
  const customized = isCustomized(settings)

  function select(t: ThemeDef) {
    if (t.id === settings.theme) return
    setSettings({ ...settings, theme: t.id, design: undefined, accent: t.accent ?? settings.accent })
    if (customized) toast('Theme changed. Your customizations were cleared.')
  }

  async function importTheme(file: File) {
    let parsed: ThemeDef | string
    try {
      parsed = parseThemeFile(JSON.parse(await file.text()))
    } catch {
      parsed = 'This file could not be read as JSON.'
    }
    if (typeof parsed === 'string') return toast(parsed)
    const t = parsed
    setSettings((s) => ({ ...s, customThemes: [...(s.customThemes ?? []), t], theme: t.id, design: undefined, accent: t.accent ?? s.accent }))
    toast(`Theme "${t.name}" imported`)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {allThemes(settings).map((t) => {
          const active = settings.theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => select(t)}
              className={`rounded-lg border p-2 text-left transition-colors duration-150 ${active ? 'border-brand-500 bg-brand-50/60' : 'border-line bg-surface hover:border-line-strong'}`}
            >
              <ThemeThumb profile={profile} settings={{ ...settings, accent: t.accent ?? settings.accent }} design={t.design} width={136} />
              <span className="mt-2 flex items-center justify-between gap-1">
                <span className="truncate text-[13px] font-medium text-ink">{t.name}</span>
                {active && <Badge tone="brand">In use</Badge>}
              </span>
              <span className="block truncate text-[11px] leading-4 text-muted">{t.custom ? 'Custom' : t.hint}</span>
            </button>
          )
        })}
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importTheme(f)
        }}
      />
      <Button size="sm" variant="ghost" icon={Upload} onClick={() => importRef.current?.click()}>
        Import a theme file
      </Button>
    </div>
  )
}

function Customize() {
  const [settings, setSettings] = useDesignSettings()
  const { theme, design } = resolveTheme(settings)
  const set = (patch: Partial<ResumeDesign>) => setSettings((s) => ({ ...s, design: { ...s.design, ...patch } }))
  const custom = settings.customThemes?.find((t) => t.id === settings.theme)
  const updateCustom = (patch: Partial<ThemeDef>) =>
    setSettings((s) => ({ ...s, customThemes: (s.customThemes ?? []).map((t) => (t.id === s.theme ? { ...t, ...patch } : t)) }))

  function duplicate() {
    const t: ThemeDef = { id: `custom-${newId()}`, name: `${theme.name} copy`, hint: 'Custom', design, accent: settings.accent, custom: true }
    setSettings((s) => ({ ...s, customThemes: [...(s.customThemes ?? []), t], theme: t.id, design: undefined }))
    toast(`Saved as "${t.name}". Rename it below.`)
  }

  return (
    <div className="space-y-4">
      <Field label="Fonts">
        <select className={inputCls} value={design.font} onChange={(e) => set({ font: e.target.value as FontPair })}>
          {Object.entries(FONTS).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Range label="Text size" value={design.size} min={8.5} max={11.5} step={0.5} unit=" pt" onChange={(size) => set({ size })} />
        <Range label="Line height" value={design.leading} min={1.2} max={1.7} step={0.05} unit="" onChange={(leading) => set({ leading })} />
        <Range label="Margins" value={design.margin} min={10} max={24} step={1} unit=" mm" onChange={(margin) => set({ margin })} />
        <Range label="Section spacing" value={design.gap} min={2} max={8} step={0.5} unit=" mm" onChange={(gap) => set({ gap })} />
      </div>
      <fieldset>
        <legend className="t-label mb-1.5 block">Accent colour</legend>
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Section headings">
          <select className={inputCls} value={design.heading} onChange={(e) => set({ heading: e.target.value as HeadingStyle })}>
            {Object.entries(HEADINGS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Header">
          <select className={inputCls} value={design.header} onChange={(e) => set({ header: e.target.value as HeaderStyle })}>
            {Object.entries(HEADERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="t-label mb-1.5 block" aria-hidden="true">
            Dates
          </span>
          <Segmented
            label="Dates"
            size="sm"
            value={design.dates}
            onChange={(dates) => set({ dates })}
            options={[
              { value: 'right', label: 'On the right' },
              { value: 'below', label: 'Below the title' },
            ]}
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" className="size-4 accent-brand-600" checked={design.icons} onChange={(e) => set({ icons: e.target.checked })} />
          Show contact icons
        </label>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button
          size="sm"
          variant="secondary"
          icon={RotateCcw}
          disabled={!isCustomized(settings) && settings.accent === (theme.accent ?? DEFAULT_ACCENT)}
          onClick={() => {
            setSettings({ ...settings, design: undefined, accent: theme.accent ?? DEFAULT_ACCENT })
            toast(`Reset to ${theme.name}`)
          }}
        >
          Reset to theme
        </Button>
        <Button size="sm" variant="secondary" icon={CopyPlus} onClick={duplicate}>
          Save as new theme
        </Button>
      </div>

      {custom && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <Field label="Theme name">
            <input className={inputCls} maxLength={40} value={custom.name} onChange={(e) => updateCustom({ name: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!isCustomized(settings) && settings.accent === custom.accent}
              onClick={() => {
                updateCustom({ design, accent: settings.accent })
                setSettings((s) => ({ ...s, design: undefined }))
                toast('Theme updated')
              }}
            >
              Update theme
            </Button>
            <Button size="sm" variant="ghost" icon={FileDown} onClick={() => download(fileName(custom.name), themeFile({ ...custom, design, accent: settings.accent }))}>
              Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              className="hover:text-danger"
              onClick={() => {
                setSettings((s) => ({ ...s, customThemes: (s.customThemes ?? []).filter((t) => t.id !== custom.id), theme: 'modern', design: undefined }))
                toast(`Theme "${custom.name}" deleted`)
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-faint">Changes apply on top of {theme.name}. Choosing another theme clears them, so save them as a theme first to keep them.</p>
    </div>
  )
}

function DesignCard({ profile }: { profile: StructuredProfile }) {
  const [settings, setSettings] = useDesignSettings()
  const [tab, setTab] = useState<'themes' | 'customize' | 'sections'>('themes')
  const toggles = ['summary', ...settings.order]
  return (
    <Card
      title="Design"
      action={
        <Segmented
          label="Design options"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'themes', label: 'Themes' },
            { value: 'customize', label: 'Customize' },
            { value: 'sections', label: 'Sections' },
          ]}
        />
      }
    >
      {tab === 'themes' && <ThemeGallery profile={profile} />}
      {tab === 'customize' && <Customize />}
      {tab === 'sections' && (
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
      )}
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
    const v: ResumeVersion = { resume: keepBasics(r.resume, version.resume), label: text, at: new Date().toISOString(), ai: true, changes: r.changes ?? [] }
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
  const [settings] = useDesignSettings()
  const [pages, setPages] = useState(1)
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
      versions: [{ resume: keepBasics(r.resume, profile), label: 'Tailored to the job', at: new Date().toISOString(), ai: true, changes: r.changes ?? [] }],
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
          <div className="flex flex-wrap items-center gap-2">
            {options.length > 0 && (
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
            )}
            <ButtonLink href="#profile" size="sm" icon={UserRoundPen}>
              Edit profile
            </ButtonLink>
            <ExportMenu size="sm" formats={['profile-jsonresume', 'profile-md', 'profile-txt']} profile={shown ?? undefined} />
            <Button
              size="sm"
              variant="brand"
              icon={FileDown}
              disabled={!shown}
              onClick={() => {
                if (!shown) return
                toast('Choose "Save as PDF" as the destination to download the resume.')
                printResume(shown.basics.name, tailored?.job.company)
              }}
            >
              Download PDF
            </Button>
          </div>
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
            <DesignCard profile={shown} />
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
              {mode === 'preview' && (
                <Badge tone={pages > 1 ? 'warning' : 'neutral'} mono>
                  A4 · {pages} {pages === 1 ? 'page' : 'pages'}
                </Badge>
              )}
              <span className="text-xs text-faint">
                {tailored ? 'Edits apply to the version shown.' : 'Edits update your structured profile.'}
              </span>
            </div>
            {mode === 'edit' ? (
              <ProfileEditor value={shown} onChange={editShown} order={settings.order} />
            ) : (
              <div className="rounded-xl border border-line bg-subtle p-3 md:p-6">
                <ResumePaper profile={shown} settings={settings} onPages={setPages} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
