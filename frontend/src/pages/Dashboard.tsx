import { ArrowRight, BarChart3, Briefcase, ChevronDown, ChevronUp, Compass, KeyRound, ShieldCheck, Star, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApplicationTrends, MiniBars, weeklyTrends } from '../components/charts'
import { Card, Chip, EmptyState } from '../components/ui'
import {
  useApiKey,
  useApplications,
  useCareerPath,
  useHistory,
  useLastMatch,
  useLastMatchJd,
  useMatches,
  useProfile,
  useStored,
  type Point,
} from '../lib/store'

function Delta({ value, unit = '' }: { value: number; unit?: string }) {
  if (value === 0) return <span className="text-xs text-slate-500">No change</span>
  const up = value > 0
  const Icon = up ? ChevronUp : ChevronDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-700' : 'text-rose-700'}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {Math.abs(value)}
      {unit} vs previous
    </span>
  )
}

function MetricCard({
  label,
  points,
  value,
  suffix = '',
  href,
  emptyText,
}: {
  label: string
  points: Point[]
  value?: number
  suffix?: string
  href: string
  emptyText: string
}) {
  const latest = value ?? points.at(-1)?.value
  const prev = points.at(-2)?.value
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-medium text-slate-600">{label}</h2>
      {latest === undefined ? (
        <>
          <p className="mt-3 flex-1 text-sm text-slate-500">{emptyText}</p>
          <a href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
            Get started <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-3">
            <span className="text-3xl font-bold tabular-nums text-slate-900">
              {latest}
              {suffix && <span className="text-lg font-semibold text-slate-400">{suffix}</span>}
            </span>
            {points.length > 0 && <MiniBars points={points} label={label} />}
          </div>
          <div className="mt-2 flex h-5 items-center">{prev !== undefined && <Delta value={(points.at(-1)?.value ?? 0) - prev} />}</div>
          <a href={href} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
            Improve <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  )
}

function KeyBanner() {
  const [dismissed, setDismissed] = useStored('bannerDismissed', false)
  const key = useApiKey()
  if (dismissed) return null
  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink p-6 text-white shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-indigo-600/30 blur-2xl" aria-hidden="true" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center">
        <ShieldCheck className="size-10 shrink-0 text-emerald-400" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">Your key, your data</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Jivika runs on your own LLM API key. The key and everything you create stay in this browser; the server
            forwards each request to your provider and keeps nothing.
          </p>
        </div>
        <a
          href="#settings"
          className="inline-flex items-center gap-2 self-start rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-indigo-50 md:self-center"
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {key ? 'Manage key' : 'Add your key'}
        </a>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  )
}

function TimelineItem({ label, title, salary, timeframe, last, accent }: { label: string; title: string; salary: string; timeframe?: string; last?: boolean; accent: string }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last && <span className="absolute left-[7px] top-5 h-full w-0.5 bg-slate-200" aria-hidden="true" />}
      <span className={`relative mt-1 size-4 shrink-0 rounded-full ring-4 ring-white ${accent}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
          {timeframe && <span className="normal-case tracking-normal"> - {timeframe}</span>}
        </div>
        <div className="font-semibold text-slate-900">{title}</div>
        {salary && (
          <div className="text-sm text-slate-600">
            {salary} <span className="text-xs text-slate-500">(Estimated)</span>
          </div>
        )}
      </div>
    </li>
  )
}

export function CareerTimeline() {
  const [path] = useCareerPath()
  if (!path) return null
  return (
    <ol>
      <TimelineItem label="You are here" title={path.current.title} salary={path.current.salary_range} accent="bg-indigo-600" />
      <TimelineItem label="Next target" title={path.next.title} salary={path.next.salary_range} timeframe={path.next.timeframe} accent="bg-emerald-500" />
      <TimelineItem label="Future potential" title={path.future.title} salary={path.future.salary_range} timeframe={path.future.timeframe} accent="bg-amber-500" last />
    </ol>
  )
}

function Stat({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums text-slate-900">{children}</div>
      {note && <div className="mt-0.5">{note}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [profile] = useProfile()
  const [history] = useHistory()
  const [applications] = useApplications()
  const [matches] = useMatches()
  const [careerPath] = useCareerPath()
  const weeks = weeklyTrends(applications)
  const windowTotal = weeks.reduce((s, w) => s + w.total, 0)
  const thisWeek = weeks.at(-1)?.total ?? 0
  const lastWeek = weeks.at(-2)?.total ?? 0
  const [, setLastMatch] = useLastMatch()
  const [, setLastMatchJd] = useLastMatchJd()
  const picks = [...matches].sort((a, b) => b.result.match_score - a.result.match_score).slice(0, 5)

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {profile?.name?.trim() ? `Welcome back, ${profile.name.trim().split(' ')[0]}` : 'Welcome to Jivika'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">Here is where your job search stands.</p>
      </div>

      <KeyBanner />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Career Score" points={history.career} href="#career" emptyText="Map your career path to get a score." />
        <MetricCard
          label="Skills"
          points={history.skills}
          href="#profile"
          emptyText="Upload your resume to extract your skills."
        />
        <MetricCard label="CV Score" points={history.cv} suffix="/100" href="#cv" emptyText="Run a CV review to get an ATS score." />
        <MetricCard label="LinkedIn Health" points={history.linkedin} suffix="/100" href="#linkedin" emptyText="Review your LinkedIn headline and about." />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Application Trends" className="lg:col-span-2">
          {applications.length ? (
            <>
              <div className="mb-4 flex gap-8">
                <Stat label="Last 8 weeks">{windowTotal}</Stat>
                <Stat label="This week" note={<Delta value={thisWeek - lastWeek} />}>
                  {thisWeek}
                </Stat>
              </div>
              <ApplicationTrends applications={applications} />
            </>
          ) : (
            <EmptyState
              icon={<BarChart3 className="size-8" />}
              title="No applications tracked yet"
              text="Log the jobs you apply to and see weekly trends by response status."
              action={<a href="#applications" className="text-sm font-medium text-indigo-700 hover:underline">Track an application</a>}
            />
          )}
        </Card>

        <Card title="Career Goals">
          {careerPath ? (
            <>
              <CareerTimeline />
              <a href="#career" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
                View plan <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </>
          ) : (
            <EmptyState
              icon={<Compass className="size-8" />}
              title="No career goals yet"
              text="See where your experience can take you next, with estimated salaries."
              action={<a href="#career" className="text-sm font-medium text-indigo-700 hover:underline">Map your career path</a>}
            />
          )}
        </Card>
      </div>

      <Card title="Top Picks" action={matches.length > 0 && <a href="#match" className="text-sm font-medium text-indigo-700 hover:underline">Match another job</a>}>
        {picks.length ? (
          <ul className="divide-y divide-slate-100">
            {picks.map(({ id, result: r, job_description }) => (
              <li key={id}>
                <a
                  href="#match"
                  onClick={() => {
                    setLastMatch(r)
                    setLastMatchJd(job_description)
                  }}
                  className="-mx-2 flex flex-wrap items-center gap-4 rounded-xl px-2 py-3 hover:bg-slate-50"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                    <Briefcase className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900" title={r.job_title || undefined}>
                      {r.job_title || 'Untitled role'}
                    </div>
                    <div className="truncate text-sm text-slate-600">{r.company || 'Company not stated'}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.experience_required && <Chip>{r.experience_required}</Chip>}
                      {r.employment_type && <Chip>{r.employment_type}</Chip>}
                      {r.location && <Chip>{r.location}</Chip>}
                      {r.salary_range && <Chip tone="emerald">{r.salary_range}</Chip>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums text-slate-900">{r.match_score}%</div>
                    <div className="text-xs text-slate-500">match</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Star className="size-8" />}
            title="No saved matches"
            text="Match your resume against a job description and save the best fits here."
            action={<a href="#match" className="text-sm font-medium text-indigo-700 hover:underline">Match a job</a>}
          />
        )}
      </Card>
    </>
  )
}
