import { ExternalLink, FlaskConical, ListPlus, Search, SearchX, SearchCheck, Target } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  Note,
  PageHeader,
  Segmented,
  Skeleton,
  scoreBand,
  toast,
} from '../components/ui'
import { api, ApiError, type Job, type JobSearchResult, type JobSource, type RemoteFilter } from '../lib/api'
import { useJobDescription, useProfile, useResume, useStored, write } from '../lib/store'

interface SearchParams {
  q: string
  location: string
  remote: RemoteFilter
  /** Source ids the user switched off. */
  excluded: string[]
}

const MAX_PAGE = 5
const RESEARCH_TIP = 'Public listings fetched on demand for research; may be unavailable'

// ponytail: results live in memory for the session; only the search itself is persisted, and re-run on a fresh load.
let lastResult: { key: string; data: JobSearchResult; page: number } | null = null
/** Sources the server has reported as enabled. Kept across searches so a source switched off can be switched back on. */
const knownEnabled = new Set<string>()

/* ---------- Quick fit (keyword overlap, computed in the browser) ---------- */

const STOP = new Set(
  'a an and are as at be by for from has have in is it of on or our the to we with you your will this that who what job role team work working years year experience strong ability skills using etc across within new about all any can more other their they them into also must should may plus well per not but if us its'.split(
    ' ',
  ),
)

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t))
}

/** Share of the job's distinct keywords (title counted three times) that appear in the resume. */
function quickFit(resumeWords: Set<string>, job: Job): number | null {
  if (!resumeWords.size) return null
  const weights = new Map<string, number>()
  for (const t of tokens(`${job.snippet} ${job.description ?? ''}`)) weights.set(t, 1)
  for (const t of tokens(job.title)) weights.set(t, 3)
  let total = 0
  let hit = 0
  for (const [t, w] of weights) {
    total += w
    if (resumeWords.has(t)) hit += w
  }
  return total ? Math.round((hit / total) * 100) : 0
}

/* ---------- Formatting ---------- */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
function relative(iso?: string): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const days = Math.round((t - Date.now()) / 86_400_000)
  if (days > -1) return rtf.format(Math.round((t - Date.now()) / 3_600_000) || 0, 'hour')
  if (days > -30) return rtf.format(days, 'day')
  return rtf.format(Math.round(days / 30), 'month')
}

const nativeId = (job: Job) => job.id.slice(job.id.indexOf(':') + 1)

/* ---------- Sources ---------- */

function SourceChip({ source: s, on, onToggle }: { source: JobSource; on: boolean; onToggle: () => void }) {
  const source = { ...s, enabled: knownEnabled.has(s.id) }
  const status = !source.enabled || !on ? 'Off' : source.ok ? String(source.count) : 'Unavailable'
  return (
    <button
      type="button"
      aria-pressed={source.enabled && on}
      disabled={!source.enabled}
      onClick={onToggle}
      title={!source.enabled ? 'Not enabled on this server' : source.error || (source.research ? RESEARCH_TIP : undefined)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed ${
        source.enabled && on ? 'border-line-strong bg-surface text-ink hover:bg-subtle' : 'border-line bg-subtle text-faint hover:text-muted'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${!source.enabled || !on ? 'bg-faint' : source.ok ? 'bg-brand-500' : 'bg-danger'}`}
        aria-hidden="true"
      />
      {source.name}
      <span className={`text-[11px] ${source.ok && on && source.enabled ? 't-num text-muted' : ''}`}>{status}</span>
      {source.research && (
        <span title={RESEARCH_TIP} className="inline-flex items-center gap-0.5 rounded bg-info-bg px-1 text-[10px] text-info">
          <FlaskConical className="size-3" strokeWidth={1.75} aria-hidden="true" />
          Research
        </span>
      )}
    </button>
  )
}

/* ---------- Result row ---------- */

function JobCard({ job, sourceName, fit, onMatch, matching }: { job: Job; sourceName: string; fit: number | null; onMatch: () => void; matching: boolean }) {
  const posted = relative(job.posted_at)
  const band = fit === null ? null : scoreBand(fit)
  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_150px] md:gap-6">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="t-title min-w-0 truncate" title={job.title}>
            {job.title}
          </h3>
          <span className="truncate text-[13px] text-muted">{job.company}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {job.location && <Badge>{job.location}</Badge>}
          {job.remote === true && <Badge tone="info">Remote</Badge>}
          {job.remote === false && <Badge>On-site</Badge>}
          {job.employment_type && <Badge>{job.employment_type}</Badge>}
          {job.salary && (
            <Badge tone="brand" mono>
              {job.salary}
            </Badge>
          )}
          <Badge variant="outline">{sourceName}</Badge>
          {posted && <span className="t-num text-[12px] text-faint">{posted}</span>}
        </div>
        {job.snippet && <p className="line-clamp-2 text-[13px] leading-5 text-muted">{job.snippet}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:border-line-strong hover:bg-subtle"
          >
            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Open
            <span className="sr-only">
              {job.title} at {job.company} (opens in a new tab)
            </span>
          </a>
          <Button size="sm" variant="brand" icon={Target} onClick={onMatch} loading={matching}>
            Match this job
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={ListPlus}
            onClick={() => {
              write('applicationDraft', {
                company: job.company,
                role: job.title,
                link: job.url,
                notes: `Found via ${sourceName} job search.${job.location ? ` ${job.location}.` : ''}`,
              })
              location.hash = 'applications?new'
            }}
          >
            Track
          </Button>
        </div>
      </div>
      <div className="md:pt-1">
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="t-overline">Quick fit</span>
          <span className="t-num font-medium text-ink">{fit === null ? '-' : `${fit}%`}</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-subtle"
          role="progressbar"
          aria-label={band ? `Quick fit, ${band.label}` : 'Quick fit, upload a resume to see it'}
          aria-valuenow={fit ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {band && <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${fit}%` }} />}
        </div>
      </div>
    </li>
  )
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Searching job boards" className="divide-y divide-line rounded-xl border border-line bg-surface">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-2.5 px-5 py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  )
}

/* ---------- Page ---------- */

export default function JobSearch() {
  const [profile] = useProfile()
  const [resume] = useResume()
  const [, setJd] = useJobDescription()
  const [saved, setSaved] = useStored<SearchParams | null>('jobSearch', null)
  const [form, setForm] = useState<SearchParams>(() => saved ?? { q: profile?.current_role ?? '', location: profile?.location ?? '', remote: 'any', excluded: [] })
  const [result, setResult] = useState(lastResult)
  const [loading, setLoading] = useState<'search' | 'more' | null>(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'relevance' | 'newest'>('relevance')
  const [matchingId, setMatchingId] = useState('')

  const resumeWords = useMemo(() => new Set(tokens(`${resume?.text ?? ''} ${(profile?.skills ?? []).join(' ')}`)), [resume, profile])

  async function search(params: SearchParams, page = 1) {
    const q = params.q.trim()
    if (!q) return
    const sources = [...knownEnabled].filter((id) => !params.excluded.includes(id))
    const key = JSON.stringify([q, params.location.trim(), params.remote, params.excluded])
    setLoading(page === 1 ? 'search' : 'more')
    setError('')
    try {
      const data = await api.jobSearch({ q, location: params.location, remote: params.remote, page, sources: params.excluded.length ? sources : undefined })
      data.sources.forEach((s) => s.enabled && knownEnabled.add(s.id))
      const prev = page > 1 && result?.key === key ? result.data.jobs : []
      const seen = new Set(prev.map((j) => j.id))
      const jobs = [...prev, ...data.jobs.filter((j) => !seen.has(j.id))]
      lastResult = { key, page: page > 1 && jobs.length === prev.length ? MAX_PAGE : page, data: { ...data, jobs } }
      setResult(lastResult)
      setSaved({ ...params, q })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Search failed. Try again.')
    } finally {
      setLoading(null)
    }
  }

  // A fresh page load re-runs the last search (the server caches it); in-app navigation keeps the results in memory.
  useEffect(() => {
    if (!lastResult && saved?.q) search(saved)
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    search(form)
  }

  function toggleSource(id: string) {
    const excluded = form.excluded.includes(id) ? form.excluded.filter((x) => x !== id) : [...form.excluded, id]
    const next = { ...form, excluded }
    setForm(next)
    if (result && form.q.trim()) search(next)
  }

  async function matchJob(job: Job) {
    let description = job.description
    if (!description) {
      setMatchingId(job.id)
      try {
        description = (await api.jobDetail(job.source, nativeId(job))).description
      } catch {
        toast('Full description unavailable; using the listing summary')
      } finally {
        setMatchingId('')
      }
    }
    const header = [job.title, job.company && `at ${job.company}`, job.location && `(${job.location})`].filter(Boolean).join(' ')
    setJd(`${header}\n${job.url}\n\n${description || job.snippet}`)
    location.hash = 'match'
  }

  const names = Object.fromEntries((result?.data.sources ?? []).map((s) => [s.id, s.name]))
  const jobs = useMemo(() => {
    const list = (result?.data.jobs ?? []).map((job) => ({ job, fit: quickFit(resumeWords, job) }))
    const time = (j: Job) => (j.posted_at ? Date.parse(j.posted_at) || 0 : 0)
    return list.sort((a, b) => (sort === 'relevance' ? (b.fit ?? 0) - (a.fit ?? 0) : 0) || time(b.job) - time(a.job))
  }, [result, resumeWords, sort])

  return (
    <>
      <PageHeader title="Job search" description="Search live listings from job boards and company career pages, then match or track them." />

      <Card>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] md:items-end">
          <Field label="Role or keywords">
            <input
              required
              maxLength={100}
              className={inputCls}
              value={form.q}
              onChange={(e) => setForm({ ...form, q: e.target.value })}
              placeholder="e.g. Product designer, React"
            />
          </Field>
          <Field label="Location">
            <input
              maxLength={80}
              className={inputCls}
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="City or country"
            />
          </Field>
          <div>
            <span className="t-label mb-1.5 block" aria-hidden="true">
              Work mode
            </span>
            <Segmented
              label="Work mode"
              value={form.remote}
              onChange={(remote) => setForm({ ...form, remote })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'remote', label: 'Remote' },
                { value: 'onsite', label: 'On-site' },
              ]}
            />
          </div>
          <Button type="submit" variant="brand" icon={Search} loading={loading === 'search'} disabled={!form.q.trim()}>
            Search
          </Button>
        </form>

        {result && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="t-overline mr-1">Sources</span>
            {result.data.sources.map((s) => (
              <SourceChip key={s.id} source={s} on={!form.excluded.includes(s.id)} onToggle={() => toggleSource(s.id)} />
            ))}
          </div>
        )}
      </Card>

      <ErrorMessage message={error} />

      {!resume?.text && result && (
        <Note>
          Upload your resume to see a quick fit for each listing.{' '}
          <a href="#profile" className="font-medium text-ink underline underline-offset-2">
            Upload resume
          </a>
        </Note>
      )}

      {loading === 'search' ? (
        <ResultsSkeleton />
      ) : !result ? (
        <Card>
          <EmptyState
            icon={<SearchCheck />}
            title="Search live job listings"
            text="Enter a role or keywords. Results come from public job boards and company career pages, with a link to each original posting."
          />
        </Card>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState icon={<SearchX />} title="No listings found" text="Try broader keywords, another location, or a different work mode." />
        </Card>
      ) : (
        <Card
          title={
            <>
              <span className="t-num">{jobs.length}</span> {jobs.length === 1 ? 'listing' : 'listings'}
            </>
          }
          description={`For "${result.data.query}". Listings are shown as published; check details on the original posting.`}
          divider
          padding={false}
          action={
            <Segmented
              label="Sort results"
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'relevance', label: 'Relevance' },
                { value: 'newest', label: 'Newest' },
              ]}
            />
          }
        >
          <ul className="divide-y divide-line">
            {jobs.map(({ job, fit }) => (
              <JobCard
                key={job.id}
                job={job}
                fit={fit}
                sourceName={names[job.source] ?? job.source}
                matching={matchingId === job.id}
                onMatch={() => matchJob(job)}
              />
            ))}
          </ul>
          {result.page < MAX_PAGE && (
            <div className="flex justify-center border-t border-line px-5 py-3">
              <Button variant="secondary" loading={loading === 'more'} onClick={() => search(saved ?? form, result.page + 1)}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
