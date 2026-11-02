import { FileUp, Undo2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, useAiReady, type StructuredProfile } from '../lib/api'
import { KIND_LABEL } from '../lib/portability/detect'
import { FIELD_LABEL, mapStatus, type AppField } from '../lib/portability/csv'
import {
  applyApplications,
  applyData,
  applyProfile,
  csvApplications,
  eventsIntoApplications,
  profileConflicts,
  readImportFile,
  sameApplication,
  type IcsEvent,
  type ImportPlan,
  type Policy,
} from '../lib/portability/import'
import { takeSnapshot, undoImport } from '../lib/portability/snapshot'
import { normalizeStructured, read, SECTION_KEYS, STATUSES, write, type Application, type SectionKey, type Status } from '../lib/store'
import { Badge, Button, ErrorMessage, inputCls, Modal, Note, toast } from './ui'

/* One import dialog for every format: pick or drop a file, preview what was found, choose Merge or Replace, apply, undo. */

const KEY_LABEL: Record<string, string> = {
  applications: 'Applications',
  structuredProfile: 'Structured profile',
  profile: 'Profile',
  resume: 'Resume',
  resumeSettings: 'Resume design and themes',
  tailoredResumes: 'Tailored resumes',
  coverLetter: 'Cover letter',
  matches: 'Saved matches',
  savedSearches: 'Saved searches',
  pastSearches: 'Past searches',
  savedJobs: 'Saved jobs',
  dismissedJobs: 'Hidden jobs',
  inbox: 'Inbox',
  atsHistory: 'ATS checks',
  history: 'Score history',
  interview: 'Interview practice',
  settings: 'Provider settings',
  daysOff: 'My days off',
  holidaySettings: 'Holiday settings',
  holidayImports: 'Imported holiday calendars',
  clipReceived: 'Clipper status',
  clipperPromoDismissed: 'Clipper card dismissed',
}
const SECTION_LABEL: Record<SectionKey, string> = {
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
  publications: 'Publications',
  references: 'References',
}

/** The items of a list that are still ticked. */
const pickChosen = <T,>(off: Record<string, Set<number>>, key: string, list: T[]) => list.filter((_, i) => !off[key]?.has(i))
const countOf = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v == null ? 0 : 1)
const s = (v: unknown) => (typeof v === 'string' ? v : '')
/** A short human label for a stored item. */
function itemLabel(v: unknown): string {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const pair = [s(o.role) || s(o.title), s(o.company) || s(o.institution)].filter(Boolean).join(' at ')
  return pair || s(o.name) || s(o.q) || s(o.group) || s(o.citation) || s(o.summary) || s(o.degree) || s(o.id) || 'Item'
}

const POLICIES: { value: Policy; label: string }[] = [
  { value: 'mine', label: 'Keep mine' },
  { value: 'file', label: "Use the file's" },
  { value: 'both', label: 'Keep both' },
]

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-w-0 items-start gap-2 text-[13px] text-ink">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}

/** A list with an "all" checkbox and one checkbox per item. `off` holds unticked indexes. */
function ItemList({ title, items, off, setOff, extra }: { title: string; items: string[]; off: Set<number>; setOff: (s: Set<number>) => void; extra?: ReactNode }) {
  const chosen = items.length - off.size
  return (
    <details className="rounded-lg border border-line">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px]">
        <span className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Include all ${title}`}
            className="size-4 rounded border-line-strong accent-brand-600"
            checked={chosen === items.length && items.length > 0}
            ref={(el) => {
              if (el) el.indeterminate = chosen > 0 && chosen < items.length
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setOff(e.target.checked ? new Set() : new Set(items.map((_, i) => i)))}
          />
          <span className="truncate font-medium text-ink">{title}</span>
          {extra}
        </span>
        <span className="t-num shrink-0 text-muted">
          {chosen} of {items.length}
        </span>
      </summary>
      <div className="max-h-56 space-y-1 overflow-y-auto border-t border-line px-3 py-2">
        {items.map((label, i) => (
          <Check
            key={i}
            checked={!off.has(i)}
            onChange={(v) => {
              const next = new Set(off)
              if (v) next.delete(i)
              else next.add(i)
              setOff(next)
            }}
          >
            {label}
          </Check>
        ))}
      </div>
    </details>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="t-label mb-1 w-full">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-[13px] text-ink">
          <input type="radio" className="accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Guesses the application an event belongs to: its Jivika link, else a company named in the title. */
function guessApp(e: IcsEvent, apps: Application[]): string {
  if (e.appId && apps.some((a) => a.id === e.appId)) return e.appId
  const t = e.title.toLowerCase()
  return apps.find((a) => a.company.trim() && t.includes(a.company.trim().toLowerCase()))?.id ?? ''
}

export function ImportDialog({
  open,
  onClose,
  file: initialFile,
  plan: initialPlan,
  onUnlinkedEvents,
  unlinkedLabel = 'Add the rest as personal calendar entries',
}: {
  open: boolean
  onClose: () => void
  /** A file to read straight away (from drag and drop). */
  file?: File | null
  /** A plan prepared elsewhere (a LinkedIn profile from Jivika Clipper), previewed straight away. */
  plan?: ImportPlan | null
  /** Calendar events not linked to an application go here (the Calendar page). Without it they are skipped. */
  onUnlinkedEvents?: (events: IcsEvent[]) => void
  unlinkedLabel?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const ai = useAiReady()
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [policy, setPolicy] = useState<Policy>('mine')
  const [off, setOff] = useState<Record<string, Set<number>>>({})
  const [skipKeys, setSkipKeys] = useState<Set<string>>(new Set())
  const [mapping, setMapping] = useState<Partial<Record<AppField, number>>>({})
  const [statusMap, setStatusMap] = useState<Record<string, Status>>({})
  const [targets, setTargets] = useState<string[]>([])
  const [unlinked, setUnlinked] = useState(true)
  const [noUndo, setNoUndo] = useState(false)
  const [done, setDone] = useState('')
  const [apps, setApps] = useState<Application[]>([])

  function reset() {
    setPlan(null)
    setFileName('')
    setBusy('')
    setError('')
    setMode('merge')
    setPolicy('mine')
    setOff({})
    setSkipKeys(new Set())
    setNoUndo(false)
    setDone('')
  }
  const close = () => {
    reset()
    onClose()
  }

  async function pick(f: File | undefined) {
    if (!f) return
    reset()
    setApps(read<Application[]>('applications', []))
    setFileName(f.name)
    setBusy('Reading the file')
    try {
      let p = await readImportFile(f)
      if (p.kind === 'resume-file') {
        setBusy('Reading the resume')
        const parsed = await api.parseResume(p.file)
        const resume = { ...parsed, fileName: f.name }
        let profile: StructuredProfile | null = null
        if (ai && parsed.text.trim()) {
          setBusy('Building your structured profile')
          profile = normalizeStructured(await api.structureProfile(parsed.text))
        }
        p = { kind: 'profile', source: p.source, profile, resume }
      }
      if (p.kind === 'applications') {
        setMapping(p.mapping)
        const col = p.mapping.status
        const values = col === undefined ? [] : [...new Set(p.rows.map((r) => (r[col] ?? '').trim()))]
        setStatusMap(Object.fromEntries(values.map((v) => [v, mapStatus(v)])))
      }
      if (p.kind === 'events') setTargets(p.events.map((e) => guessApp(e, read<Application[]>('applications', []))))
      setPlan(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.')
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    if (open && initialFile) void pick(initialFile)
    // pick is stable enough: it only reads state setters and the AI flag.
  }, [open, initialFile])

  useEffect(() => {
    if (!open || !initialPlan) return
    reset()
    setPlan(initialPlan)
    setFileName(KIND_LABEL[initialPlan.source])
  }, [open, initialPlan])

  async function structure(text: string, source: ImportPlan['source']) {
    setBusy('Building your structured profile')
    setError('')
    try {
      const profile = normalizeStructured(await api.structureProfile(text))
      setPlan({ kind: 'profile', source, profile })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The resume could not be structured.')
    } finally {
      setBusy('')
    }
  }

  /* ---------- What would be imported ---------- */

  const csvApps = useMemo(() => (plan?.kind === 'applications' ? csvApplications(plan.rows, mapping, statusMap) : []), [plan, mapping, statusMap])

  const dataSelection = useMemo(() => {
    if (plan?.kind !== 'data') return {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(plan.data)) {
      if (skipKeys.has(k)) continue
      if (!Array.isArray(v)) out[k] = v
      else if (!v.length || pickChosen(off, k, v).length) out[k] = pickChosen(off, k, v)
    }
    return out
  }, [plan, off, skipKeys])

  const profileSelection = useMemo(() => {
    if (plan?.kind !== 'profile' || !plan.profile) return null
    const p = { ...plan.profile } as unknown as Record<string, unknown[]>
    for (const k of SECTION_KEYS) p[k] = pickChosen(off, k, p[k])
    return p as unknown as StructuredProfile
  }, [plan, off])

  const conflicts = useMemo(() => {
    if (!plan) return 0
    if (plan.kind === 'data')
      return Object.entries(dataSelection).reduce((n, [k, v]) => {
        const local = read<unknown>(k, null)
        if (k === 'applications' && Array.isArray(local) && Array.isArray(v)) return n + (v as Application[]).filter((a) => (local as Application[]).some((l) => sameApplication(l, a))).length
        if (Array.isArray(local) && Array.isArray(v)) {
          const ids = new Set(local.map((x) => (x as { id?: unknown })?.id).filter(Boolean))
          return n + v.filter((x) => ids.has((x as { id?: unknown })?.id)).length
        }
        return n + (local != null && !Array.isArray(v) ? 1 : 0)
      }, 0)
    if (plan.kind === 'profile') return profileSelection ? profileConflicts(read<StructuredProfile | null>('structuredProfile', null), profileSelection) : 0
    if (plan.kind === 'applications') return pickChosen(off, 'apps', csvApps).filter((a) => apps.some((l) => sameApplication(l, a))).length
    return 0
  }, [plan, dataSelection, profileSelection, csvApps, apps, off])

  const total =
    plan?.kind === 'data'
      ? Object.keys(dataSelection).length
      : plan?.kind === 'profile'
        ? (profileSelection ? SECTION_KEYS.reduce((n, k) => n + profileSelection[k].length, 0) + 1 : 0) + (plan.resume ? 1 : 0)
        : plan?.kind === 'applications'
          ? pickChosen(off, 'apps', csvApps).length
          : plan?.kind === 'events'
            ? pickChosen(off, 'events', plan.events).length
            : 0

  /* ---------- Applying ---------- */

  function apply() {
    if (!plan) return
    if (!noUndo && !takeSnapshot(`${KIND_LABEL[plan.source]}: ${fileName}`)) {
      setError('There is not enough browser storage to keep an undo copy. Export your data first, or import without undo.')
      setNoUndo(true)
      return
    }
    try {
      let summary = ''
      if (plan.kind === 'data') {
        applyData(dataSelection, mode, policy)
        summary = `Imported ${Object.keys(dataSelection).length} stored ${Object.keys(dataSelection).length === 1 ? 'item' : 'items'}`
      } else if (plan.kind === 'profile') {
        applyProfile(profileSelection, plan.resume, mode, policy)
        summary = profileSelection ? 'Profile imported' : 'Resume saved'
      } else if (plan.kind === 'applications') {
        const list = pickChosen(off, 'apps', csvApps)
        applyApplications(list, mode, policy)
        summary = `Imported ${list.length} ${list.length === 1 ? 'application' : 'applications'}`
      } else if (plan.kind === 'events') {
        const events = plan.events.map((e, i) => ({ ...e, target: targets[i] ?? '' })).filter((_, i) => !off.events?.has(i))
        const linked = events.filter((e) => e.target)
        write('applications', eventsIntoApplications(read<Application[]>('applications', []), linked, policy))
        const rest = events.filter((e) => !e.target)
        if (rest.length && onUnlinkedEvents && unlinked) onUnlinkedEvents(rest)
        summary = `Added ${linked.length} ${linked.length === 1 ? 'event' : 'events'} to applications${rest.length ? (onUnlinkedEvents && unlinked ? `, ${rest.length} as personal entries` : `, skipped ${rest.length} without an application`) : ''}`
      }
      if (conflicts && mode === 'merge' && plan.kind !== 'events') summary += ` (${conflicts} already here: ${policies.find((x) => x.value === policy)!.label.toLowerCase()})`
      setDone(summary)
      toast(summary)
    } catch (e) {
      if (!noUndo) undoImport()
      setError(noUndo ? `The import stopped part way: ${e instanceof Error ? e.message : 'unknown error'}. Some data may have been changed.` : e instanceof Error ? `Nothing was changed: ${e.message}` : 'Nothing was changed: the import failed.')
    }
  }

  /* ---------- Rendering ---------- */

  // A clip from the LinkedIn profile page is not a file: no file picker, and wording that names LinkedIn.
  const fromLinkedIn = plan?.source === 'linkedin-profile'
  const policies = fromLinkedIn ? POLICIES.map((p) => (p.value === 'file' ? { ...p, label: "Use LinkedIn's" } : p)) : POLICIES
  const foundLabel = !plan
    ? ''
    : fromLinkedIn && plan.kind === 'profile'
      ? `LinkedIn profile (${SECTION_KEYS.filter((k) => countOf(plan.profile?.[k])).length} sections)`
      : KIND_LABEL[plan.source]
  const pickButton = (
    <>
      <Button variant="secondary" icon={FileUp} onClick={() => input.current?.click()} disabled={!!busy}>
        {plan || error ? 'Choose another file' : 'Choose a file'}
      </Button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )

  const footer = done ? (
    <>
      {!noUndo && (
        <Button
          variant="secondary"
          icon={Undo2}
          onClick={() => {
            if (undoImport()) toast('Import undone')
            close()
          }}
        >
          Undo import
        </Button>
      )}
      <Button data-autofocus onClick={close}>
        Done
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={close}>
        Cancel
      </Button>
      {plan && plan.kind !== 'resume-text' && plan.kind !== 'resume-file' && (
        <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={apply} disabled={!total}>
          {noUndo ? 'Import without undo' : mode === 'replace' ? 'Replace' : 'Import'}
        </Button>
      )}
    </>
  )

  const canReplace = plan && plan.kind !== 'events'
  const replaceHint =
    plan?.kind === 'data'
      ? 'Replace deletes the data in this browser first (your API key stays).'
      : plan?.kind === 'profile'
        ? 'Replace swaps your structured profile for the one in the file.'
        : 'Replace swaps your applications for the ones in the file.'

  return (
    <Modal open={open} onClose={close} title="Import" description={fileName || 'Jivika exports, JSON Resume, Europass, LinkedIn data, CSV, calendars and resumes'} footer={footer} width="max-w-2xl">
      <div className="space-y-4 text-sm">
        {done ? (
          <p role="status" className="text-ink">
            {done}. You can undo this until the next import.
          </p>
        ) : (
          <>
            {!plan && !busy && (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation() // the Settings section around the dialog also listens for drops
                  setDragging(false)
                  void pick(e.dataTransfer.files[0])
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center ${dragging ? 'border-brand-500 bg-brand-50/60' : 'border-line-strong bg-canvas'}`}
              >
                <Upload className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-[13px] text-muted">Drop a file here, or</p>
                {pickButton}
                <p className="max-w-md text-xs text-faint">
                  The type is worked out from the content. Files stay in this browser, except resumes in PDF, Word or image form, which are read by the
                  Jivika server like any resume upload.
                </p>
              </div>
            )}
            {busy && (
              <p role="status" className="animate-pulse text-muted">
                {busy}...
              </p>
            )}
            <ErrorMessage message={error} />

            {plan && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ink">
                  Found: <Badge tone="info">{foundLabel}</Badge>
                </p>
                {!fromLinkedIn && pickButton}
              </div>
            )}

            {plan?.kind === 'data' && (
              <div className="space-y-2">
                {plan.version < 2 && <Note>This export is from an older version of Jivika. It is updated to the current format as it is imported.</Note>}
                {Object.entries(plan.data).map(([k, v]) =>
                  Array.isArray(v) && v.length ? (
                    <div key={k} className={skipKeys.has(k) ? 'opacity-50' : ''}>
                      <ItemList title={KEY_LABEL[k] ?? k} items={v.map(itemLabel)} off={off[k] ?? new Set()} setOff={(x) => setOff({ ...off, [k]: x })} />
                    </div>
                  ) : (
                    <div key={k} className="rounded-lg border border-line px-3 py-2">
                      <Check
                        checked={!skipKeys.has(k)}
                        onChange={(c) => {
                          const next = new Set(skipKeys)
                          if (c) next.delete(k)
                          else next.add(k)
                          setSkipKeys(next)
                        }}
                      >
                        <span className="font-medium">{KEY_LABEL[k] ?? k}</span>
                        <span className="t-num ml-2 text-muted">{countOf(v) > 1 ? `${countOf(v)} entries` : ''}</span>
                      </Check>
                    </div>
                  ),
                )}
                {plan.skipped.length > 0 && (
                  <Note tone="warning">
                    Skipped entries this version of Jivika does not recognise: {plan.skipped.slice(0, 8).join(', ')}
                    {plan.skipped.length > 8 ? ` and ${plan.skipped.length - 8} more` : ''}.
                  </Note>
                )}
              </div>
            )}

            {plan?.kind === 'profile' && (
              <div className="space-y-2">
                {plan.resume && (
                  <Note>
                    Resume text read from {plan.resume.fileName} (<span className="t-num">{plan.resume.characters}</span> characters). It will be saved as your resume.
                  </Note>
                )}
                {plan.profile ? (
                  <>
                    <p className="text-[13px] text-muted">
                      {[plan.profile.basics.name, plan.profile.basics.headline, plan.profile.basics.email].filter(Boolean).join(' | ') || 'No contact details found.'}
                    </p>
                    {SECTION_KEYS.filter((k) => plan.profile![k].length).map((k) => (
                      <ItemList
                        key={k}
                        title={SECTION_LABEL[k]}
                        items={(plan.profile![k] as unknown[]).map((x) => (k === 'languages' ? [s((x as { name: unknown }).name), s((x as { level: unknown }).level)].filter(Boolean).join(': ') : itemLabel(x)))}
                        off={off[k] ?? new Set()}
                        setOff={(x) => setOff({ ...off, [k]: x })}
                      />
                    ))}
                  </>
                ) : (
                  <Note tone="warning">Add a model API key in Settings (or use the demo model) to build a structured profile from this resume. The resume text can still be saved.</Note>
                )}
              </div>
            )}

            {plan?.kind === 'resume-text' && (
              <div className="space-y-3">
                <p className="text-[13px] text-muted">
                  {plan.source === 'linkedin-profile'
                    ? 'Jivika Clipper could not tell the sections of this profile apart. Jivika can build a structured profile from the page text with your model; entries the text does not contain are left out.'
                    : 'This looks like a resume in plain text or Markdown. Jivika can turn it into a structured profile with your model.'}
                </p>
                <pre className="max-h-40 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-xs whitespace-pre-wrap text-ink">{plan.text.slice(0, 1200)}</pre>
                <Button onClick={() => structure(plan.text, plan.source)} disabled={!ai || !!busy} loading={busy !== ''}>
                  Build profile from this text
                </Button>
                {!ai && <Note tone="warning">Add a model API key in Settings to build a profile from text.</Note>}
              </div>
            )}

            {plan?.kind === 'applications' && (
              <div className="space-y-3">
                <details open={plan.headers.some((_, i) => !Object.values(mapping).includes(i))} className="rounded-lg border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">Columns</summary>
                  <div className="grid gap-2 border-t border-line px-3 py-2 sm:grid-cols-2">
                    {plan.headers.map((h, i) => {
                      const field = (Object.keys(mapping) as AppField[]).find((f) => mapping[f] === i) ?? ''
                      return (
                        <label key={i} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="truncate text-ink">{h || `Column ${i + 1}`}</span>
                          <select
                            className={`${inputCls} w-40`}
                            value={field}
                            onChange={(e) => {
                              const next = { ...mapping }
                              if (field) delete next[field]
                              const f = e.target.value as AppField | ''
                              if (f) next[f] = i
                              setMapping(next)
                            }}
                          >
                            <option value="">Ignore</option>
                            {(Object.keys(FIELD_LABEL) as AppField[]).map((f) => (
                              <option key={f} value={f}>
                                {FIELD_LABEL[f]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                  </div>
                </details>
                {Object.keys(statusMap).length > 0 && (
                  <details className="rounded-lg border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">Statuses</summary>
                    <div className="grid gap-2 border-t border-line px-3 py-2 sm:grid-cols-2">
                      {Object.entries(statusMap).map(([ext, st]) => (
                        <label key={ext} className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="truncate text-ink">{ext || '(blank)'}</span>
                          <select className={`${inputCls} w-40`} value={st} onChange={(e) => setStatusMap({ ...statusMap, [ext]: e.target.value as Status })}>
                            {STATUSES.map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                {mapping.company === undefined && mapping.role === undefined ? (
                  <Note tone="warning">Choose which column holds the company or the role.</Note>
                ) : (
                  <ItemList
                    title="Applications"
                    items={csvApps.map((a) => `${itemLabel(a)}, ${a.status}${a.date ? `, ${a.date}` : ''}`)}
                    off={off.apps ?? new Set()}
                    setOff={(x) => setOff({ ...off, apps: x })}
                  />
                )}
              </div>
            )}

            {plan?.kind === 'events' && (
              <div className="space-y-2">
                {plan.events.length === 0 && <Note>The calendar has no events.</Note>}
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {plan.events.map((e, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <Check
                          checked={!off.events?.has(i)}
                          onChange={(c) => {
                            const next = new Set(off.events ?? [])
                            if (c) next.delete(i)
                            else next.add(i)
                            setOff({ ...off, events: next })
                          }}
                        >
                          <span className="font-medium">{e.title || 'Untitled event'}</span>
                          <span className="t-num ml-2 text-muted">
                            {e.date}
                            {e.time ? ` ${e.time}` : ''}
                          </span>
                        </Check>
                      </div>
                      <select
                        aria-label={`Application for ${e.title || 'event'}`}
                        className={`${inputCls} w-56`}
                        value={targets[i] ?? ''}
                        onChange={(ev) => setTargets(targets.map((t, j) => (j === i ? ev.target.value : t)))}
                      >
                        <option value="">No application</option>
                        {apps.map((a) => (
                          <option key={a.id} value={a.id}>
                            {itemLabel(a)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {onUnlinkedEvents ? (
                  <Check checked={unlinked} onChange={setUnlinked}>
                    {unlinkedLabel}
                  </Check>
                ) : (
                  <p className="text-xs text-muted">Events without an application are skipped. Interviews and follow-ups are added to the application you pick.</p>
                )}
              </div>
            )}

            {plan && total > 0 && plan.kind !== 'resume-text' && (
              <div className="space-y-3 border-t border-line pt-3">
                {canReplace && (
                  <Choice
                    label="How to import"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'merge', label: 'Merge with my data' },
                      { value: 'replace', label: 'Replace' },
                    ]}
                  />
                )}
                {mode === 'replace' && canReplace ? (
                  <p className="text-[13px] text-muted">{replaceHint}</p>
                ) : (
                  <>
                    <Choice
                      label={conflicts ? `When an entry already exists (${conflicts} found)` : 'When an entry already exists'}
                      value={policy}
                      onChange={setPolicy}
                      options={policies}
                    />
                    <p className="text-xs text-muted">
                      Entries match by id, applications also by company and role, and profile entries by name. Keep both adds the {fromLinkedIn ? 'LinkedIn' : "file's"} entry as a copy.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

