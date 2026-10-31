import { BookmarkPlus, Briefcase, Check, ListPlus, MapPin, Target } from 'lucide-react'
import { useState } from 'react'
import { ResumeSource } from '../components/Resume'
import {
  ActionHint,
  Badge,
  BulletList,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  KeyNotice,
  PageHeader,
  ProgressBar,
  ScoreRing,
  Segmented,
  Skeleton,
  SkeletonCard,
  textareaCls,
  toast,
} from '../components/ui'
import { api, useAction, useAiReady, type MatchResult } from '../lib/api'
import { newId, today, useApplications, useJobDescription, useLastMatch, useLastMatchJd, useMatches, useResume } from '../lib/store'

type Tab = 'skills' | 'insights' | 'plan'

function SkillGroup({ title, items, missing }: { title: string; items: string[]; missing?: boolean }) {
  return (
    <div>
      <h3 className="t-label mb-2">
        {title} <span className="t-num text-faint">{items.length}</span>
      </h3>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => (
            <Badge key={s} tone={missing ? 'danger' : 'brand'} variant={missing ? 'outline' : 'soft'}>
              {s}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted">{missing ? 'No missing skills found.' : 'No matching skills found.'}</p>
      )}
    </div>
  )
}

function Insight({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <h3 className="t-overline mb-2">{title}</h3>
      <BulletList items={items} />
    </div>
  )
}

function MatchResults({ result: r, jd }: { result: MatchResult; jd: string }) {
  const [tab, setTab] = useState<Tab>('skills')
  const [matches, setMatches] = useMatches()
  const [, setApplications] = useApplications()
  const savedId = matches.find((m) => m.job_description === jd && m.result.job_title === r.job_title)?.id

  function save() {
    setMatches((m) => [...m, { id: newId(), savedAt: new Date().toISOString(), job_description: jd, result: r }])
    toast('Saved to top picks')
  }

  function track() {
    setApplications((a) => [{ id: newId(), company: r.company, role: r.job_title, date: today(), status: 'Applied', link: '', notes: '' }, ...a])
    toast('Added to applications')
    location.hash = 'applications'
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-muted">
            <Briefcase className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-[12rem] flex-1">
            <h2 className="text-base leading-6 font-semibold text-ink">{r.job_title || 'Untitled role'}</h2>
            <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
              <span>{r.company || 'Company not stated'}</span>
              {r.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {r.location}
                </span>
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.experience_required && <Badge>{r.experience_required}</Badge>}
              {r.employment_type && <Badge>{r.employment_type}</Badge>}
              {r.salary_range ? (
                <Badge tone="brand" mono>
                  {r.salary_range}
                </Badge>
              ) : (
                <Badge variant="outline">Salary not stated</Badge>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="secondary" icon={savedId ? Check : BookmarkPlus} disabled={!!savedId} onClick={save}>
              {savedId ? 'Saved' : 'Save to top picks'}
            </Button>
            <Button variant="primary" icon={ListPlus} onClick={track}>
              Track application
            </Button>
          </div>
        </div>
      </Card>

      <Card padding={false}>
        <div className="grid items-center gap-6 p-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <ScoreRing value={r.match_score} label="Match score" size={104} />
          <div className="space-y-4">
            <ProgressBar value={r.keyword_coverage} label="Keyword coverage" />
            <p className="text-sm text-ink">{r.summary}</p>
          </div>
        </div>
      </Card>

      <Card
        title="Analysis"
        divider
        action={
          <Segmented
            label="Result section"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'skills', label: 'Skills', count: r.matched_skills.length + r.missing_skills.length },
              { value: 'insights', label: 'Insights' },
              { value: 'plan', label: 'Transition plan', count: r.transition_plan.length },
            ]}
          />
        }
      >
        {tab === 'skills' && (
          <div className="grid gap-6 sm:grid-cols-2">
            <SkillGroup title="Matched" items={r.matched_skills} />
            <SkillGroup title="Missing" items={r.missing_skills} missing />
          </div>
        )}
        {tab === 'insights' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Insight title="Strengths" items={r.strengths} />
            <Insight title="Gaps" items={r.gaps} />
            <Insight title="Challenges" items={r.challenges} />
            <Insight title="Opportunities" items={r.opportunities} />
          </div>
        )}
        {tab === 'plan' &&
          (r.transition_plan.length ? (
            <ol className="ml-3 border-l border-line">
              {r.transition_plan.map((s, i) => (
                <li key={i} className="relative pb-5 pl-6 last:pb-0">
                  <span
                    className="t-num absolute top-0 -left-3 flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface text-[11px] font-medium text-ink"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="t-title">{s.step}</span>
                    {s.timeframe && (
                      <Badge tone="info" mono>
                        {s.timeframe}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-muted">{s.detail}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No transition steps were suggested for this role.</p>
          ))}
      </Card>
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Analyzing match">
      <div className="flex gap-4 rounded-xl border border-line bg-surface p-5">
        <Skeleton className="size-10 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <div className="flex gap-1.5 pt-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6 rounded-xl border border-line bg-surface p-5">
        <Skeleton className="size-[104px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <SkeletonCard lines={5} label="Loading skills" />
    </div>
  )
}

export default function JobMatch() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [result, setResult] = useLastMatch()
  const [resultJd, setResultJd] = useLastMatchJd()
  const key = useAiReady()
  const match = useAction(api.match)
  const jdShort = jd.trim().length < 30

  async function analyze() {
    if (!resume?.text) return
    const r = await match.run(resume.text, jd)
    if (r) {
      setResult(r)
      setResultJd(jd)
    }
  }

  return (
    <>
      <PageHeader title="Job match" description="See how well your resume fits a role, what is missing, and how to close the gap." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Inputs" description="Your saved resume and the job description.">
            <div className="space-y-4">
              <ResumeSource />
              <Field label="Job description">
                <textarea
                  className={`${textareaCls} h-56`}
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Paste the full job description here."
                />
              </Field>
              <KeyNotice />
              <ErrorMessage message={match.error} />
              <Button variant="brand" icon={Target} className="w-full" onClick={analyze} loading={match.loading} disabled={!key || !resume?.text || jdShort}>
                Run job match
              </Button>
              <ActionHint show={key && resume?.text && jdShort}>Paste at least a few lines of the job description to continue.</ActionHint>
            </div>
          </Card>
        </div>

        <div className="min-w-0">
          {match.loading ? (
            <ResultsSkeleton />
          ) : result ? (
            <MatchResults result={result} jd={resultJd} />
          ) : (
            <Card>
              <EmptyState
                icon={<Target />}
                title="No match yet"
                text="Your match score, skills analysis and transition plan will appear here."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
