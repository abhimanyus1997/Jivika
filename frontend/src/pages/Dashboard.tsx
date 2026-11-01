import { ArrowRight, BarChart3, Bell, Check, Compass, Funnel, Plus, ShieldCheck, Sparkles, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApplicationTrends, MiniBars, weeklyTrends } from '../components/charts'
import { codingStats, useCoding } from '../components/coding/store'
import { Badge, ButtonLink, Card, CareerTimeline, EmptyState, Note, PageHeader, Segmented, StatCell, scoreBand } from '../components/ui'
import {
  useApiKey,
  useApplications,
  useCareerPath,
  useHistory,
  useLastMatch,
  useLastMatchJd,
  useMatches,
  useProfile,
  roadmapProgress,
  useResume,
  useRoadmapDone,
  useSavedSearches,
  useStored,
  write,
  type Application,
  type Point,
  type Status,
} from '../lib/store'
import { useDemoActive } from '../lib/api'

function greeting(name?: string) {
  const first = name?.trim().split(/\s+/)[0]
  if (!first) return 'Your job search at a glance.'
  const h = new Date().getHours()
  return `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, ${first}.`
}

const delta = (points: Point[]) => (points.length > 1 ? points[points.length - 1].value - points[points.length - 2].value : null)

function GetStarted() {
  const key = useApiKey()
  const demo = useDemoActive()
  const [resume] = useResume()
  const [matches] = useMatches()
  const [lastMatch] = useLastMatch()
  const [applications] = useApplications()
  const [noteDismissed, setNoteDismissed] = useStored('bannerDismissed', false)

  const steps = [
    demo
      ? { title: 'Connect a model key', text: 'Add your own key for unlimited use.', done: true, optional: true, href: '#settings', cta: 'Add your key' }
      : { title: 'Connect a model key', text: 'Add your own provider key in Settings.', done: !!key, href: '#settings', cta: 'Open settings' },
    { title: 'Upload your resume', text: 'Jivika extracts your profile and skills.', done: !!resume, href: '#profile', cta: 'Upload resume' },
    { title: 'Run your first job match', text: 'Compare your resume with a job description.', done: matches.length > 0 || !!lastMatch, href: '#match', cta: 'Run job match' },
    { title: 'Track an application', text: 'Log a job you applied to and follow its status.', done: applications.length > 0, href: '#applications?new', cta: 'Add application' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const next = steps.findIndex((s) => !s.done)

  return (
    <Card
      title="Get started"
      description="Four steps to a complete picture of your job search."
      action={
        <span className="t-num text-[13px] text-muted">
          {done}/{steps.length} done
        </span>
      }
      divider
      padding={false}
    >
      <div className="px-5 pt-4">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-subtle"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={steps.length}
        >
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-150" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="grid gap-px p-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-lg p-3">
            <div className="flex items-center gap-2">
              {s.done ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                  <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                </span>
              ) : (
                <span
                  className={`t-num flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    i === next ? 'bg-surface text-brand-700 ring-2 ring-brand-500' : 'border border-dashed border-line-strong text-faint'
                  }`}
                >
                  {i + 1}
                </span>
              )}
              <span className={`t-title ${s.done && !s.optional ? 'text-muted line-through decoration-line-strong' : ''}`}>{s.title}</span>
              <span className="sr-only">{s.optional ? '(using demo)' : s.done ? '(done)' : '(to do)'}</span>
              {s.optional && <Badge tone="info">Using demo</Badge>}
            </div>
            <p className="text-[13px] leading-5 text-muted">{s.text}</p>
            {(!s.done || s.optional) && (
              <ButtonLink href={s.href} size="sm" variant={i === next && !s.optional ? 'brand' : 'secondary'} className="self-start">
                {s.cta}
              </ButtonLink>
            )}
          </li>
        ))}
      </ol>
      {!noteDismissed && (
        <div className="border-t border-line px-5 py-3">
          <Note icon={ShieldCheck} onDismiss={() => setNoteDismissed(true)}>
            {demo
              ? 'Your data stays in this browser. Requests go to the shared demo model (Groq) until you add your own key.'
              : 'Your key and data stay in this browser. The server forwards each request to your provider and keeps nothing.'}
          </Note>
        </div>
      )}
    </Card>
  )
}

function KpiStrip() {
  const [history] = useHistory()
  const [careerPath] = useCareerPath()
  const [done] = useRoadmapDone()
  const items = careerPath?.roadmap?.stages.flatMap((s) => s.items) ?? []
  const roadmap = items.length ? `Roadmap ${roadmapProgress(items, done).pct}% complete` : undefined
  const [codingSession] = useCoding()
  const coding = codingStats(codingSession)
  const cells = [
    { label: 'Career score', points: history.career, href: '#career', empty: 'Map your career path', note: roadmap },
    { label: 'Skills', points: history.skills, href: '#profile', empty: 'Upload your resume' },
    { label: 'CV score', points: history.cv, suffix: '/100', href: '#cv', empty: 'Run a CV review' },
    { label: 'LinkedIn health', points: history.linkedin, suffix: '/100', href: '#linkedin', empty: 'Review your LinkedIn' },
    { label: 'ATS score', points: history.ats, suffix: '/100', href: '#ats', empty: 'Run an ATS check' },
  ]
  return (
    <Card padding={false}>
      {/* 1px gaps over a line-colored background draw the dividers for any cell count. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line lg:grid-cols-5 [&>*]:bg-surface [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        {cells.map((c) => (
          <StatCell
            key={c.label}
            label={c.label}
            value={c.points.at(-1)?.value ?? null}
            suffix={c.suffix}
            delta={delta(c.points)}
            chart={c.points.length > 1 && <MiniBars points={c.points} label={c.label} />}
            href={c.href}
            linkLabel={c.points.length ? 'Improve' : 'Start'}
            empty={c.empty}
            note={c.note}
          />
        ))}
      </div>
      {coding.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 text-[13px]">
          <span className="text-muted">
            <span className="font-medium text-ink">Coding practice</span>{' '}
            <span className="tabular-nums">
              {coding.solved} solved / {coding.attempted} attempted
            </span>{' '}
            of {coding.total} problems
          </span>
          <a href="#interview" onClick={() => write('interview.tab', 'coding')} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
            Practise
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </Card>
  )
}

function TrendsCard() {
  const [applications] = useApplications()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const weeks = useMemo(() => weeklyTrends(applications), [applications])
  const windowTotal = weeks.reduce((s, w) => s + w.total, 0)
  const change = (weeks.at(-1)?.total ?? 0) - (weeks.at(-2)?.total ?? 0)

  return (
    <Card
      title="Application trends"
      description="Weekly applications by response status, last 8 weeks."
      className="h-full lg:col-span-8"
      action={
        applications.length > 0 && (
          <Segmented
            label="Trends view"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'table', label: 'Table' },
            ]}
          />
        )
      }
    >
      {applications.length ? (
        <div className="space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="t-metric">{windowTotal}</span>
            <span className="text-[13px] text-muted">{windowTotal === 1 ? 'application' : 'applications'}</span>
            {change !== 0 ? (
              <Badge tone={change > 0 ? 'brand' : 'neutral'} mono>
                {change > 0 ? '+' : '-'}
                {Math.abs(change)} vs last week
              </Badge>
            ) : (
              <span className="text-[13px] text-faint">Same as last week</span>
            )}
          </div>
          <ApplicationTrends rows={weeks} view={view} />
        </div>
      ) : (
        <EmptyState
          icon={<BarChart3 />}
          title="No applications tracked yet"
          text="Log the jobs you apply to and see weekly trends by response status."
          action={
            <ButtonLink href="#applications?new" icon={Plus} size="sm">
              Add application
            </ButtonLink>
          }
        />
      )}
    </Card>
  )
}

type Range = '30' | '90' | 'all'

const STAGES: { label: string; reached: Status[] }[] = [
  { label: 'Applied', reached: [] },
  // A rejection is still a reply, so it counts as a response.
  { label: 'Response', reached: ['Response received', 'Interview', 'Offer', 'Rejected'] },
  { label: 'Interview', reached: ['Interview', 'Offer'] },
  { label: 'Offer', reached: ['Offer'] },
]

/** Applications (applied within the range) that ever reached each stage, from the status timeline. */
export function funnelCounts(apps: Application[], range: Range, now = new Date()) {
  const cutoff = range === 'all' ? '' : new Date(now.getTime() - Number(range) * 864e5).toLocaleDateString('en-CA')
  const inRange = apps.filter((a) => !cutoff || a.date >= cutoff)
  return STAGES.map((st) => ({
    label: st.label,
    count: st.reached.length
      ? inRange.filter((a) => [a.status, ...(a.history ?? []).map((h) => h.status)].some((s) => st.reached.includes(s))).length
      : inRange.length,
  }))
}

function FunnelCard() {
  const [applications] = useApplications()
  const [range, setRange] = useStored<Range>('funnelRange', '90')
  const rows = useMemo(() => funnelCounts(applications, range), [applications, range])
  const top = rows[0].count
  return (
    <Card
      title="Application funnel"
      description="How far your applications get. Responses include rejections."
      className="h-full lg:col-span-5"
      action={
        <Segmented
          label="Funnel range"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'all', label: 'All time' },
          ]}
        />
      }
    >
      {top ? (
        <table className="w-full text-[13px]">
          <caption className="sr-only">Applications reaching each stage</caption>
          <thead className="sr-only">
            <tr>
              <th>Stage</th>
              <th>Applications</th>
              <th>Conversion from previous stage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = i ? rows[i - 1].count : 0
              const conv = i && prev ? Math.round((r.count / prev) * 100) : null
              return (
                <tr key={r.label} title={`${r.label}: ${r.count}${conv !== null ? `, ${conv}% of ${rows[i - 1].label.toLowerCase()}` : ''}`}>
                  <th scope="row" className="w-24 py-2 pr-3 text-left font-medium text-ink">
                    {r.label}
                  </th>
                  <td className="py-2">
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 flex-1">
                        {r.count > 0 && (
                          <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(2, (r.count / top) * 100)}%`, background: 'var(--color-series-1)' }} />
                        )}
                      </div>
                      <span className="t-num w-8 text-right font-medium text-ink">{r.count}</span>
                    </div>
                  </td>
                  <td className="t-num w-14 py-2 pl-3 text-right text-muted">{i === 0 ? '' : conv === null ? '-' : `${conv}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          icon={<Funnel />}
          title={applications.length ? 'No applications in this range' : 'No applications tracked yet'}
          text="Track applications and update their status to see how many get a response, an interview and an offer."
        />
      )}
    </Card>
  )
}

function SavedSearchNote() {
  const [searches] = useSavedSearches()
  const total = searches.reduce((s, x) => s + (x.newCount || 0), 0)
  if (!total) return null
  return (
    <Note icon={Bell} tone="info">
      <span className="t-num font-medium">{total}</span> new {total === 1 ? 'job' : 'jobs'} in saved searches.{' '}
      <a href="#jobs" className="font-medium underline underline-offset-2">
        View in Job search
      </a>
    </Note>
  )
}

function GoalsCard() {
  const [careerPath] = useCareerPath()
  return (
    <Card
      title="Career goals"
      className="h-full lg:col-span-4"
      action={
        careerPath && (
          <a href="#career" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
            View plan <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        )
      }
    >
      {careerPath ? (
        <CareerTimeline path={careerPath} />
      ) : (
        <EmptyState
          icon={<Compass />}
          title="No career goals yet"
          text="See where your experience can take you next, with estimated salaries."
          action={
            <ButtonLink href="#career" size="sm">
              Map your career path
            </ButtonLink>
          }
        />
      )}
    </Card>
  )
}

function TopPicks() {
  const [matches] = useMatches()
  const [, setLastMatch] = useLastMatch()
  const [, setLastMatchJd] = useLastMatchJd()
  const picks = [...matches].sort((a, b) => b.result.match_score - a.result.match_score).slice(0, 5)

  return (
    <Card
      title="Top picks"
      description={picks.length ? 'Your best saved matches. Open one to see the full analysis.' : undefined}
      padding={false}
      divider={picks.length > 0}
      action={
        matches.length > 0 && (
          <ButtonLink href="#match" size="sm" icon={Sparkles}>
            Match another job
          </ButtonLink>
        )
      }
    >
      {picks.length ? (
        <>
          <div className="hidden grid-cols-[minmax(0,1fr)_140px_160px] gap-4 border-b border-line bg-subtle px-5 py-2 md:grid">
            <span className="t-overline">Role</span>
            <span className="t-overline">Match</span>
            <span className="t-overline text-right">Salary</span>
          </div>
          <ul className="divide-y divide-line">
            {picks.map(({ id, result: r, job_description }) => {
              const band = scoreBand(r.match_score)
              const tags = [r.experience_required, r.employment_type, r.location].filter(Boolean)
              return (
                <li key={id}>
                  <a
                    href="#match"
                    onClick={() => {
                      setLastMatch(r)
                      setLastMatchJd(job_description)
                    }}
                    className="grid gap-3 px-5 py-3 transition-colors duration-150 hover:bg-subtle md:grid-cols-[minmax(0,1fr)_140px_160px] md:items-center md:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="t-title truncate" title={r.job_title || undefined}>
                          {r.job_title || 'Untitled role'}
                        </span>
                        <span className="truncate text-[13px] text-muted">{r.company || 'Company not stated'}</span>
                      </div>
                      {tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="t-num w-10 text-[13px] font-medium text-ink">{r.match_score}%</span>
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle md:bg-canvas"
                        role="progressbar"
                        aria-label={`Match score, ${band.label}`}
                        aria-valuenow={r.match_score}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${Math.max(0, Math.min(100, r.match_score))}%` }} />
                      </div>
                    </div>
                    <span className={`t-num truncate text-[13px] md:text-right ${r.salary_range ? 'text-ink' : 'text-faint'}`}>
                      {r.salary_range || 'Not stated'}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<Star />}
          title="No saved matches"
          text="Match your resume against a job description and save the best fits here."
          action={
            <ButtonLink href="#match" size="sm">
              Run job match
            </ButtonLink>
          }
        />
      )}
    </Card>
  )
}

export default function Dashboard() {
  const [profile] = useProfile()
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={greeting(profile?.name)}
        actions={
          <>
            <ButtonLink href="#applications?new" icon={Plus}>
              Add application
            </ButtonLink>
            <ButtonLink href="#match" variant="brand" icon={Sparkles}>
              Run job match
            </ButtonLink>
          </>
        }
      />
      <GetStarted />
      <SavedSearchNote />
      <KpiStrip />
      <div className="grid gap-6 lg:grid-cols-12">
        <TrendsCard />
        <GoalsCard />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <FunnelCard />
        <div className="min-w-0 lg:col-span-7 [&>section]:h-full">
          <TopPicks />
        </div>
      </div>
    </>
  )
}
