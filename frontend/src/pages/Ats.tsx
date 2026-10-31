import { CircleAlert, CircleCheck, CircleX, ExternalLink, History, ScanText, Trash2, type LucideIcon } from 'lucide-react'
import { JobImport } from '../components/JobImport'
import { ResumeSource } from '../components/Resume'
import {
  ActionHint,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  Note,
  PageHeader,
  ProgressBar,
  ScoreRing,
  SkeletonCard,
  textareaCls,
  type BadgeTone,
} from '../components/ui'
import { api, useAction, useAiReady, type AtsCategory, type AtsResult, type AtsStatus } from '../lib/api'
import { roadmapUrlForSkill } from '../lib/roadmap'
import { newId, pushHistory, useAtsHistory, useJobDescription, useResume, type AtsRun } from '../lib/store'

const CATEGORIES: { id: AtsCategory; label: string }[] = [
  { id: 'parsing', label: 'Parsing' },
  { id: 'sections', label: 'Sections' },
  { id: 'contact', label: 'Contact details' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'content', label: 'Content' },
]

const STATUS: Record<AtsStatus, { icon: LucideIcon; cls: string; label: string }> = {
  pass: { icon: CircleCheck, cls: 'text-brand-600', label: 'Pass' },
  warn: { icon: CircleAlert, cls: 'text-warning', label: 'Warning' },
  fail: { icon: CircleX, cls: 'text-danger', label: 'Fail' },
}

const GRADE_TONE: Record<AtsResult['grade'], BadgeTone> = { Excellent: 'brand', Good: 'brand', Fair: 'warning', 'Needs work': 'danger' }
const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const

export default function Ats() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [runs, setRuns] = useAtsHistory()
  const ai = useAiReady()
  const action = useAction(api.atsCheck)
  const current = runs[0]

  async function run() {
    if (!resume?.text) return
    const r = await action.run(resume.text, jd.trim(), resume.meta)
    if (!r) return
    const entry: AtsRun = {
      id: newId(),
      date: new Date().toISOString(),
      fileName: resume.fileName || 'Saved resume',
      job: jd.trim().split('\n')[0].slice(0, 80),
      result: r,
    }
    setRuns((prev) => [entry, ...prev].slice(0, 20))
    pushHistory('ats', r.score)
  }

  return (
    <>
      <PageHeader
        title="ATS checker"
        description="Check how applicant tracking systems read your resume: parsing, sections, formatting, content and, with a job description, keywords."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-6 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Inputs" description="Your saved resume and, optionally, a job description.">
            <div className="space-y-4">
              <ResumeSource />
              {resume?.text && !resume.meta && (
                <Note>Layout checks (columns, tables, images) need a PDF upload. Pasted text is checked for content only.</Note>
              )}
              <JobImport onImport={(text) => setJd(text)} />
              <Field label="Job description" hint="Optional. Adds keyword and title checks.">
                <textarea className={`${textareaCls} h-40`} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description." />
              </Field>
              {!ai && <Note>Without a model key the built-in checks still run. Add a key in Settings for skill extraction and content notes.</Note>}
              <ErrorMessage message={action.error} />
              <Button variant="brand" icon={ScanText} className="w-full" onClick={run} loading={action.loading} disabled={!resume?.text}>
                {current ? 'Check again' : 'Check resume'}
              </Button>
              <ActionHint show={!resume?.text}>Upload a resume to continue.</ActionHint>
            </div>
          </Card>
          {runs.length > 1 && <RunHistory runs={runs} onClear={() => setRuns([])} />}
        </div>

        <div className="min-w-0 space-y-6">
          {action.loading ? (
            <>
              <SkeletonCard lines={3} label="Checking your resume" />
              <SkeletonCard lines={6} label="Running checks" />
            </>
          ) : current ? (
            <Results result={current.result} />
          ) : (
            <Card>
              <EmptyState
                icon={<ScanText />}
                title="No ATS check yet"
                text="Your ATS score, a checklist of what passed and failed, keyword gaps and prioritised fixes will appear here."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function RunHistory({ runs, onClear }: { runs: AtsRun[]; onClear: () => void }) {
  return (
    <Card title="History" padding={false} divider action={<IconButton icon={Trash2} label="Clear ATS history" size="sm" onClick={onClear} />}>
      <ul className="divide-y divide-line">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
            <History className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{r.job || r.fileName}</span>
              <span className="t-num block text-xs text-faint">{new Date(r.date).toLocaleString()}</span>
            </span>
            <Badge tone={GRADE_TONE[r.result.grade]} mono>
              {r.result.score}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Results({ result: r }: { result: AtsResult }) {
  const categories = CATEGORIES.filter((c) => r.categories?.[c.id] !== undefined)
  const fixesText = r.fixes.map((f) => `- [${f.priority}] ${f.text}`).join('\n')
  return (
    <>
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing value={r.score} label="ATS score" size={112} showLabel={false} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-title">ATS score</h2>
              <Badge tone={GRADE_TONE[r.grade]} dot>
                {r.grade}
              </Badge>
            </div>
            <p className="text-sm text-muted">{r.summary}</p>
            {r.note && <Note tone="info">{r.note}</Note>}
          </div>
        </div>
      </Card>

      {categories.length > 0 && (
        <Card title="By category">
          <div className="grid gap-4 sm:grid-cols-2">
            {categories.map((c) => (
              <ProgressBar key={c.id} label={c.label} value={r.categories![c.id]!} suffix="/100" />
            ))}
          </div>
        </Card>
      )}

      {r.fixes.length > 0 && (
        <Card title="Fixes" description="Most important first." action={<CopyButton text={fixesText} label="Copy fixes" />} padding={false}>
          <ol className="divide-y divide-line border-t border-line">
            {r.fixes.map((f, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-3 text-sm text-ink">
                <Badge tone={PRIORITY_TONE[f.priority]}>{f.priority[0].toUpperCase() + f.priority.slice(1)}</Badge>
                <span className="min-w-0 flex-1">{f.text}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {r.keywords && <Keywords k={r.keywords} />}

      <Card title="Checklist" padding={false}>
        <div className="divide-y divide-line border-t border-line">
          {CATEGORIES.map((c) => {
            const checks = r.checks.filter((x) => x.category === c.id)
            if (!checks.length) return null
            return (
              <section key={c.id} aria-label={c.label} className="px-5 py-4">
                <h3 className="t-overline mb-2">{c.label}</h3>
                <ul className="space-y-3">
                  {checks.map((x) => {
                    const s = STATUS[x.status]
                    return (
                      <li key={x.id} className="flex gap-2.5">
                        <s.icon className={`mt-0.5 size-4 shrink-0 ${s.cls}`} strokeWidth={1.75} aria-hidden="true" />
                        <div className="min-w-0 flex-1 text-[13px] leading-5">
                          <div className="font-medium text-ink">
                            <span className="sr-only">{s.label}: </span>
                            {x.label}
                          </div>
                          {x.detail && <p className="text-muted">{x.detail}</p>}
                          {x.fix && x.status !== 'pass' && <p className="mt-0.5 text-ink">Fix: {x.fix}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </Card>
    </>
  )
}

function Chips({ title, items, missing }: { title: string; items: string[]; missing?: boolean }) {
  return (
    <div>
      <h4 className="t-label mb-2">
        {title} <span className="t-num text-faint">{items.length}</span>
      </h4>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((s) => {
            const url = missing ? roadmapUrlForSkill(s) : null
            const badge = (
              <Badge tone={missing ? 'danger' : 'brand'} variant={missing ? 'outline' : 'soft'}>
                {s}
                {url && <ExternalLink className="ml-1 inline size-3" strokeWidth={1.75} aria-hidden="true" />}
              </Badge>
            )
            return (
              <li key={s}>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" title={`Learn ${s} on roadmap.sh`} className="rounded-md hover:opacity-80">
                    {badge}
                    <span className="sr-only"> (roadmap.sh guide)</span>
                  </a>
                ) : (
                  badge
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">None.</p>
      )}
    </div>
  )
}

function Keywords({ k }: { k: NonNullable<AtsResult['keywords']> }) {
  const hasPreferred = k.preferred_found.length + k.preferred_missing.length > 0
  return (
    <Card
      title="Keywords"
      description="Skills from the job description found in your resume. Missing skills with a guide link to roadmap.sh."
      action={
        <Badge tone={k.title_match ? 'brand' : 'warning'} dot>
          {k.title_match ? 'Title matches' : 'Title differs'}
        </Badge>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Chips title="Required, found" items={k.required_found} />
          <Chips title="Required, missing" items={k.required_missing} missing />
          {hasPreferred && <Chips title="Preferred, found" items={k.preferred_found} />}
          {hasPreferred && <Chips title="Preferred, missing" items={k.preferred_missing} missing />}
        </div>
        {k.top_terms.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <caption className="t-label mb-2 text-left">Most frequent job description terms</caption>
              <thead>
                <tr className="border-b border-line text-faint">
                  <th scope="col" className="py-1.5 font-medium">
                    Term
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Job description
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Resume
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {k.top_terms.map((t) => (
                  <tr key={t.term}>
                    <td className="py-1.5 text-ink">{t.term}</td>
                    <td className="t-num py-1.5 text-right text-ink">{t.jd_count}</td>
                    <td className={`t-num py-1.5 text-right ${t.resume_count ? 'text-ink' : 'text-danger'}`}>{t.resume_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
