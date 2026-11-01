import { ArrowRight, BarChart3, Bell, Check, Compass, Funnel, Plus, ShieldCheck, Sparkles, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApplicationTrends, MiniBars, startedOn, weeklyTrends } from '../components/charts'
import { CLIPPER_URL, useClipReceived } from '../components/ClipperPromo'
import { codingStats, useCoding } from '../components/coding/store'
import { FunnelFlow, FunnelTable, funnelData } from '../components/FunnelFlow'
import { Badge, ButtonLink, Card, CareerTimeline, EmptyState, Note, PageHeader, Segmented, StatCell, scoreBand } from '../components/ui'
import { calendarYears, useOffDays } from '../lib/holidays'
import { addDays, calendarEntries, dayLabel } from '../lib/ics'
import { needsAnswer, useInbox } from '../lib/inbox'
import {
  isTerminal,
  normStatus,
  useApiKey,
  useApplications,
  useCareerPath,
  useHistory,
  useLastMatch,
  useLastMatchJd,
  useMatches,
  useProfile,
  roadmapProgress,
  today,
  useResume,
  useRoadmapDone,
  useSavedSearches,
  useStored,
  write,
  type Application,
  type Point,
} from '../lib/store'
import { useDemoActive, useLocalProvider } from '../lib/api'
import { Agenda, MonthGrid } from './Calendar'

function greeting(name?: string) {
  const first = name?.trim().split(/\s+/)[0]
  if (!first) return 'Your job search at a glance'
  const h = new Date().getHours()
  return `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}, ${first}`
}

const delta = (points: Point[]) => (points.length > 1 ? points[points.length - 1].value - points[points.length - 2].value : null)

function GetStarted() {
  const local = useLocalProvider()
  const key = useApiKey() || (local ? 'local' : '')
  const demo = useDemoActive()
  const [resume] = useResume()
  const [matches] = useMatches()
  const [lastMatch] = useLastMatch()
  const [applications] = useApplications()
  const [noteDismissed, setNoteDismissed] = useStored('bannerDismissed', false)
  const clipReceived = useClipReceived()

  const steps = [
    demo
      ? { title: 'Connect a model key', text: 'Add your own key for unlimited use.', done: true, optional: true, href: '#settings', cta: 'Add your key' }
      : { title: 'Connect a model key', text: 'Add your own provider key in Settings.', done: !!key, href: '#settings', cta: 'Open settings' },
    { title: 'Upload your resume', text: 'Jivika extracts your profile and skills.', done: !!resume, href: '#profile', cta: 'Upload resume' },
    { title: 'Run your first job match', text: 'Compare your resume with a job description.', done: matches.length > 0 || !!lastMatch, href: '#match', cta: 'Run job match' },
    { title: 'Start an application', text: 'Add a job you want and follow it from draft to offer.', done: applications.length > 0, href: '#new-application', cta: 'New application' },
    { title: 'Install Jivika Clipper', text: 'Send jobs from LinkedIn, Naukri and other sites in one click.', done: clipReceived, href: CLIPPER_URL, cta: 'Get the Clipper' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const next = steps.findIndex((s) => !s.done)

  return (
    <Card
      title="Get started"
      description="Five steps to a complete picture of your job search."
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
      <ol className="grid gap-px p-2 sm:grid-cols-2 lg:grid-cols-5">
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

type Range = '30' | '90' | 'all'

const RANGE_TEXT: Record<Range, string> = { '30': 'In the last 30 days', '90': 'In the last 90 days', all: 'So far' }

/** Applications started within the range (by created date, or the tracked date for older entries). */
function inRange(apps: Application[], range: Range) {
  if (range === 'all') return apps
  const cutoff = addDays(today(), -Number(range))
  return apps.filter((a) => startedOn(a) >= cutoff)
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** One calm sentence about where things are, built from the data. */
function summarySentence(apps: Application[], range: Range) {
  if (!apps.length) return range === 'all' ? 'Nothing tracked yet. Start an application when you find a role you like.' : 'No applications started in this period.'
  const by = (list: string[]) => apps.filter((a) => list.includes(normStatus(a.status))).length
  const groups: [number, string, string][] = [
    [by(['Draft']), 'still a draft', 'still drafts'],
    [by(['Applied']), 'waiting to hear back', 'waiting to hear back'],
    [by(['Screening', 'Interview']), 'in conversation', 'in conversation'],
    [by(['Offer']), 'with an offer', 'with offers'],
    [by(['Accepted']), 'accepted', 'accepted'],
  ]
  const parts = groups.filter(([c]) => c > 0).map(([c, one, many]) => `${c} ${c === 1 ? one : many}`)
  const head = `${RANGE_TEXT[range]} you have ${n(apps.length, 'application')}`
  if (!parts.length) return `${head}, all of them closed.`
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  return `${head}: ${list}.`
}

function RangeCards({ apps, range }: { apps: Application[]; range: Range }) {
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-12">
        <FunnelCard apps={apps} />
        <WorthALook />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <WeeklyCard apps={apps} range={range} />
        <StatusCard apps={apps} />
      </div>
    </>
  )
}

function FunnelCard({ apps }: { apps: Application[] }) {
  const data = useMemo(() => funnelData(apps), [apps])
  const pct = data.sent ? Math.round((data.heardBack / data.sent) * 100) : 0
  const stats = [
    { label: 'Sent', value: String(data.sent) },
    { label: 'Heard back', value: `${pct}%` },
    { label: 'Reached interview', value: String(data.interviews) },
  ]
  return (
    <Card title="Your funnel" description="Where your sent applications got to. A rejection counts as hearing back." className="h-full lg:col-span-8">
      {data.sent ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-4">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-[13px] text-muted">{s.label}</dt>
                <dd className="t-metric">{s.value}</dd>
              </div>
            ))}
          </dl>
          <FunnelFlow data={data} />
          <details className="text-[13px]">
            <summary className="cursor-pointer font-medium text-muted hover:text-ink">Show the numbers</summary>
            <div className="mt-3">
              <FunnelTable data={data} />
            </div>
          </details>
        </div>
      ) : (
        <EmptyState
          icon={<Funnel />}
          title={apps.length ? 'Nothing sent in this period' : 'No applications tracked yet'}
          text="Send an application and update its status as you hear back to see how far your applications get."
        />
      )}
    </Card>
  )
}

function WeeklyCard({ apps, range }: { apps: Application[]; range: Range }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const weeks = useMemo(() => {
    if (range !== 'all') return range === '30' ? 5 : 13
    const first = apps.reduce((m, a) => (startedOn(a) && startedOn(a) < m ? startedOn(a) : m), today())
    return Math.max(8, Math.min(52, Math.ceil((Date.parse(today()) - Date.parse(first)) / (7 * 864e5)) + 1))
  }, [apps, range])
  const rows = useMemo(() => weeklyTrends(apps, weeks), [apps, weeks])
  return (
    <Card
      title="Week by week"
      description="Applications you started and sent each week."
      className="h-full lg:col-span-7"
      action={
        apps.length > 0 && (
          <Segmented
            label="Weekly view"
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
      {apps.length ? (
        <ApplicationTrends rows={rows} view={view} />
      ) : (
        <EmptyState icon={<BarChart3 />} title="No applications in this period" text="Start an application and see your weekly pace here." />
      )}
    </Card>
  )
}

const STATUS_ORDER = ['Draft', 'Applied', 'Screening', 'Interview', 'Offer', 'Accepted', 'Declined', 'Rejected', 'Withdrawn']
const STATUS_COLOR: Record<string, string> = {
  Draft: 'var(--color-line-strong)',
  Applied: 'var(--color-series-neutral)',
  Screening: 'var(--color-info)',
  Interview: 'var(--color-accent-500)',
  Offer: 'var(--color-brand-500)',
  Accepted: 'var(--color-brand-700)',
  Declined: 'var(--color-faint)',
  Rejected: 'var(--color-series-3)',
  Withdrawn: 'var(--color-muted)',
}

function StatusCard({ apps }: { apps: Application[] }) {
  const counts = new Map<string, number>()
  for (const a of apps) counts.set(normStatus(a.status), (counts.get(normStatus(a.status)) ?? 0) + 1)
  const rows = [...STATUS_ORDER, ...[...counts.keys()].filter((s) => !STATUS_ORDER.includes(s))]
    .map((s) => ({ status: s, count: counts.get(s) ?? 0 }))
    .filter((r) => r.count > 0)
  return (
    <Card
      title="Where things stand"
      className="h-full lg:col-span-5"
      action={
        <a href="#applications" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
          Open board <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      }
    >
      {apps.length ? (
        <div className="space-y-4">
          <div
            className="flex h-3 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`Current status: ${rows.map((r) => `${r.count} ${r.status.toLowerCase()}`).join(', ')}.`}
          >
            {rows.map((r) => (
              <div key={r.status} style={{ flexGrow: r.count, background: STATUS_COLOR[r.status] ?? 'var(--color-faint)' }} title={`${r.status}: ${r.count}`} />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {rows.map((r) => (
              <li key={r.status} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: STATUS_COLOR[r.status] ?? 'var(--color-faint)' }} aria-hidden="true" />
                <span className="flex-1 truncate text-muted">{r.status}</span>
                <span className="t-num font-medium text-ink">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] text-muted">No applications in this period.</p>
      )}
    </Card>
  )
}

const appHref = (id: string) => `#application?id=${encodeURIComponent(id)}`
const who = (a: Application) => [a.role, a.company].filter(Boolean).join(' at ') || 'Untitled application'

/** Most recent day anything happened on an application. */
const lastTouched = (a: Application) => [startedOn(a), a.date, ...(a.history ?? []).map((h) => h.date)].filter(Boolean).sort().at(-1) ?? ''

function WorthALook() {
  const [apps] = useApplications()
  const [inbox] = useInbox()
  const items = useMemo(() => {
    const now = today()
    const out: { key: string; text: string; href: string; action: string }[] = []
    for (const e of calendarEntries(apps)) {
      if (e.kind === 'interview' && e.date >= now && e.date <= addDays(now, 3)) {
        const when = e.date === now ? 'today' : `on ${dayLabel(e.date)}`
        out.push({ key: e.uid, text: `Interview with ${e.company || 'the employer'} ${when}${e.time ? ` at ${e.time}` : ''}.`, href: '#interview', action: 'Prepare' })
      }
    }
    for (const a of apps) {
      if (normStatus(a.status) === 'Draft' && a.deadline && a.deadline <= addDays(now, 7)) {
        out.push({
          key: `d-${a.id}`,
          text: a.deadline < now ? `The apply-by date for ${who(a)} has passed.` : `Apply by ${dayLabel(a.deadline)} for ${who(a)}.`,
          href: appHref(a.id),
          action: 'Finish',
        })
      }
    }
    for (const a of apps) {
      if (normStatus(a.status) === 'Offer') {
        out.push({ key: `o-${a.id}`, text: `The offer from ${a.company || 'an employer'} is waiting for your decision.`, href: appHref(a.id), action: 'Review' })
      }
    }
    for (const i of inbox.filter(needsAnswer)) {
      out.push({ key: `m-${i.id}`, text: `${i.sender_name || i.sender_company || 'An employer'} is waiting for a reply.`, href: '#inbox', action: 'Reply' })
    }
    const stale = addDays(now, -14)
    const planned = new Set(calendarEntries(apps).filter((e) => e.date >= now && !e.done).map((e) => e.appId))
    for (const a of apps) {
      const s = normStatus(a.status)
      if (s === 'Draft' || s === 'Offer' || isTerminal(s) || planned.has(a.id)) continue
      const last = lastTouched(a)
      if (last && last <= stale) {
        const days = Math.round((Date.parse(now) - Date.parse(last)) / 864e5)
        out.push({ key: `s-${a.id}`, text: `No news on ${who(a)} for ${days} days.`, href: appHref(a.id), action: 'Follow up' })
      }
    }
    return out
  }, [apps, inbox])

  return (
    <Card title="Worth a look" className="h-full lg:col-span-4" padding={false} divider={items.length > 0}>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.slice(0, 6).map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="text-[13px] leading-5 text-ink">{i.text}</span>
              <a href={i.href} className="shrink-0 text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
                {i.action}
              </a>
            </li>
          ))}
          {items.length > 6 && <li className="px-5 py-2.5 text-xs text-muted">{n(items.length - 6, 'more item')}</li>}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted">You are all caught up. Upcoming interviews, apply-by dates and replies you owe show up here.</p>
      )}
    </Card>
  )
}

function CalendarCard() {
  const [apps] = useApplications()
  const entries = useMemo(() => calendarEntries(apps), [apps])
  const now = today()
  const [month, setMonth] = useState(now.slice(0, 8) + '01')
  const week = entries.filter((e) => e.date >= now && e.date <= addDays(now, 7) && !e.done)
  const { off } = useOffDays(calendarYears(month))
  const offWeek = [...off.entries()].filter(([d, list]) => d >= now && d <= addDays(now, 7) && list.some((h) => h.off)).map(([d]) => d)
  return (
    <Card
      title="Calendar"
      className="h-full lg:col-span-5"
      action={
        <a href="#calendar" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline">
          Open calendar <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      }
    >
      <div className="space-y-4">
        <MonthGrid entries={entries} month={month} onMonth={setMonth} compact off={off} />
        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink">Next 7 days</h3>
          <Agenda entries={week} empty="Nothing scheduled this week." off={off} extraDays={offWeek} />
        </div>
      </div>
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
  const [applications] = useApplications()
  const [range, setRange] = useStored<Range>('funnelRange', '90')
  const apps = useMemo(() => inRange(applications, range), [applications, range])
  return (
    <>
      <PageHeader
        title={greeting(profile?.name)}
        description={summarySentence(apps, range)}
        actions={
          <>
            <Segmented
              label="Date range for the dashboard"
              value={range}
              onChange={setRange}
              options={[
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
                { value: 'all', label: 'All time' },
              ]}
            />
            <ButtonLink href="#new-application" variant="brand" icon={Plus}>
              New application
            </ButtonLink>
          </>
        }
      />
      <GetStarted />
      <SavedSearchNote />
      <RangeCards apps={apps} range={range} />
      <div className="grid gap-6 lg:grid-cols-12">
        <CalendarCard />
        <div className="min-w-0 lg:col-span-7 [&>section]:h-full">
          <TopPicks />
        </div>
      </div>
      <KpiStrip />
      <GoalsCard />
    </>
  )
}
