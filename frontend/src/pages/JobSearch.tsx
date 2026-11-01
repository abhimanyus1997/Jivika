import {
  BellRing,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  ExternalLink,
  EyeOff,
  FlaskConical,
  History,
  ListPlus,
  Play,
  RefreshCw,
  Rocket,
  Search,
  SearchCheck,
  SearchX,
  Target,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  inputCls,
  Modal,
  Note,
  PageHeader,
  Segmented,
  Skeleton,
  scoreBand,
  toast,
} from '../components/ui'
import { api, ApiError, type Job, type JobSearchResult, type JobSource, type RemoteFilter } from '../lib/api'
import { addPastSearch, toggleJob, useDismissedJobs, usePastSearches, useSavedJobs, type PastSearch } from '../lib/jobs-store'
import { newId, placeParts, useJobDescription, useProfile, useResume, useSavedSearches, useStored, write, type SavedSearch } from '../lib/store'
import { startApplicationFromJob } from './NewApplication'

interface SearchParams {
  q: string
  location: string
  remote: RemoteFilter
  /** Source ids the user switched off. */
  excluded: string[]
}

type Tab = 'search' | 'past' | 'saved' | 'dismissed'
type Posted = 'any' | '1' | '3' | '7' | '30'

const MAX_PAGE = 5
const RESEARCH_TIP = 'Public listings fetched on demand for research; may be unavailable'

// ponytail: results live in memory for the session; only the search itself is persisted, and re-run on a fresh load.
let lastResult: { key: string; data: JobSearchResult; page: number; at: string } | null = null
/** Sources the server has reported as enabled. Kept across searches so a source switched off can be switched back on. */
const knownEnabled = new Set<string>()
/** Full descriptions fetched for listings that arrived with a summary only. */
const descriptions = new Map<string, string>()

const wideQuery = matchMedia('(min-width: 1024px)')
const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      wideQuery.addEventListener('change', cb)
      return () => wideQuery.removeEventListener('change', cb)
    },
    () => wideQuery.matches,
  )

/* ---------- Quick fit (keyword overlap, computed in the browser) ---------- */

const STOP = new Set(
  'a an and are as at be by for from has have in is it of on or our the to we with you your will this that who what job role team work working years year experience strong ability skills using etc across within new about all any can more other their they them into also must should may plus well per not but if us its'.split(
    ' ',
  ),
)

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t))
}

/**
 * 60% title-word overlap with the resume, 40% for resume keywords found in the listing text (full marks at 15),
 * so a long posting is not diluted and a title-only listing is not inflated.
 */
function quickFit(resumeWords: Set<string>, job: Job): number | null {
  if (!resumeWords.size) return null
  const title = new Set(tokens(job.title))
  const titleHits = [...title].filter((t) => resumeWords.has(t)).length
  const descHits = new Set(tokens(`${job.snippet} ${job.description ?? ''}`).filter((t) => resumeWords.has(t))).size
  return Math.round(100 * (0.6 * (title.size ? titleHits / title.size : 0) + 0.4 * Math.min(1, descHits / 15)))
}

/* ---------- Formatting ---------- */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'long' })
function relative(iso?: string): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const mins = Math.round((t - Date.now()) / 60_000)
  if (mins > -60) return rtf.format(mins, 'minute')
  if (mins > -1440) return rtf.format(Math.round(mins / 60), 'hour')
  const days = Math.round(mins / 1440)
  if (days > -30) return rtf.format(days, 'day')
  return rtf.format(Math.round(days / 30), 'month')
}

const nativeId = (job: Job) => job.id.slice(job.id.indexOf(':') + 1)
const workMode = (job: Job) => (job.remote === true ? 'Remote' : job.remote === false ? 'On-site' : '')

/** Names for sources the server may not label (older servers, or before the first response). */
const SOURCE_NAMES: Record<string, string> = { hn: 'Hacker News (Who is hiring)', yc: 'YC startups' }

const POSTED: { value: Posted; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
]

/** Listings without a posting date are left out once a time window is chosen. */
function postedWithin(job: Job, posted: Posted) {
  if (posted === 'any') return true
  const t = job.posted_at ? Date.parse(job.posted_at) : NaN
  return !Number.isNaN(t) && Date.now() - t <= Number(posted) * 86_400_000
}

/* ---------- Saved searches ---------- */

const MAX_SEEN = 1000
const norm = (s: string) => s.trim().toLowerCase()
const sameSearch = (a: Pick<SavedSearch, 'q' | 'location' | 'remote' | 'excluded'>, b: SearchParams) =>
  norm(a.q) === norm(b.q) && norm(a.location) === norm(b.location) && a.remote === b.remote && [...a.excluded].sort().join() === [...b.excluded].sort().join()
const describe = (s: Pick<SavedSearch, 'location' | 'remote' | 'excluded'>) =>
  [s.location.trim() || 'Any location', s.remote === 'any' ? '' : s.remote === 'remote' ? 'Remote' : 'On-site', s.excluded.length ? `${s.excluded.length} sources off` : '']
    .filter(Boolean)
    .join(' · ')

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
      {source.name || SOURCE_NAMES[source.id] || source.id}
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

/* ---------- Results list and detail pane ---------- */

interface Row {
  job: Job
  fit: number | null
  isNew?: boolean
}

function JobRow({ row, sourceName, selected, saved, onSelect }: { row: Row; sourceName: string; selected: boolean; saved: boolean; onSelect: () => void }) {
  const { job, fit, isNew } = row
  const posted = relative(job.posted_at)
  const meta = placeParts(job.location, workMode(job)).join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={`block w-full border-l-2 px-4 py-3 text-left transition-colors duration-150 ${
          selected ? 'border-brand-500 bg-brand-50/60' : 'border-transparent hover:bg-subtle'
        }`}
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="t-title block truncate" title={job.title}>
              {job.title}
            </span>
            <span className="block truncate text-[13px] text-muted">{[job.company, meta].filter(Boolean).join(' · ')}</span>
          </span>
          {saved && <BookmarkCheck className="mt-0.5 size-4 shrink-0 text-brand-600" strokeWidth={1.75} aria-label="Saved" />}
          {fit !== null && <span className="t-num shrink-0 text-[12px] font-medium text-ink">{fit}%</span>}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {isNew && (
            <Badge tone="accent" dot>
              New
            </Badge>
          )}
          {job.salary && (
            <Badge tone="brand" mono>
              {job.salary}
            </Badge>
          )}
          <Badge variant="outline">{sourceName}</Badge>
          {posted && <span className="t-num text-[12px] text-faint">{posted}</span>}
        </span>
      </button>
    </li>
  )
}

/** Full description for a listing, fetched on demand when the search returned a summary only. */
function useDescription(job: Job) {
  const known = job.description || descriptions.get(job.id) || ''
  const [state, setState] = useState<{ id: string; text: string; loading: boolean }>({ id: job.id, text: known, loading: false })
  useEffect(() => {
    if (known) return setState({ id: job.id, text: known, loading: false })
    let live = true
    setState({ id: job.id, text: '', loading: true })
    api
      .jobDetail(job.source, nativeId(job))
      .then((r) => {
        if (r.description) descriptions.set(job.id, r.description)
        if (live) setState({ id: job.id, text: r.description || '', loading: false })
      })
      .catch(() => live && setState({ id: job.id, text: '', loading: false }))
    return () => {
      live = false
    }
  }, [job.id])
  return state.id === job.id ? state : { id: job.id, text: known, loading: !known }
}

const linkBtn =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:border-line-strong hover:bg-subtle'

function JobDetail({
  row,
  sourceName,
  saved,
  dismissed,
  onSave,
  onDismiss,
  onMatch,
}: {
  row: Row
  sourceName: string
  saved: boolean
  dismissed: boolean
  onSave: () => void
  onDismiss: () => void
  onMatch: (description: string) => void
}) {
  const { job, fit } = row
  const desc = useDescription(job)
  const text = desc.text || job.snippet
  const band = fit === null ? null : scoreBand(fit)
  const posted = relative(job.posted_at)
  const meta = [job.company, ...placeParts(job.location, workMode(job)), job.employment_type].filter(Boolean).join(' · ')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base leading-6 font-semibold text-ink">{job.title}</h2>
        <p className="text-[13px] text-muted">{meta}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {job.salary && (
            <Badge tone="brand" mono>
              {job.salary}
            </Badge>
          )}
          <Badge variant="outline">{sourceName}</Badge>
          {posted && <span className="t-num text-[12px] text-faint">Posted {posted}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="brand"
          icon={Rocket}
          onClick={() =>
            startApplicationFromJob({
              title: job.title,
              company: job.company,
              location: job.location,
              url: job.url,
              description: text,
              salary: job.salary,
              posted_at: job.posted_at,
              source: sourceName,
            })
          }
        >
          Start application
        </Button>
        <Button size="sm" variant="secondary" icon={saved ? BookmarkCheck : Bookmark} aria-pressed={saved} onClick={onSave}>
          {saved ? 'Saved' : 'Save'}
        </Button>
        <a href={job.url} target="_blank" rel="noopener noreferrer" className={linkBtn}>
          <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Open posting
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <Button size="sm" variant="secondary" icon={Target} onClick={() => onMatch(desc.text)}>
          Match this job
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={ListPlus}
          onClick={() => {
            write('applicationDraft', {
              company: job.company,
              role: job.title,
              link: job.url,
              notes: `Found via ${sourceName} job search.${job.location ? ` ${job.location}.` : ''}`,
              description: text,
            })
            location.hash = 'applications?new'
          }}
        >
          Track
        </Button>
        <Button size="sm" variant="ghost" icon={dismissed ? Undo2 : EyeOff} onClick={onDismiss}>
          {dismissed ? 'Restore' : 'Dismiss'}
        </Button>
      </div>

      <div>
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

      <div className="border-t border-line pt-4">
        <h3 className="t-overline mb-2">Description</h3>
        {desc.loading ? (
          <div role="status" aria-label="Loading the description" className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <p className="text-[13px] leading-6 whitespace-pre-line text-ink">{text || 'No description in this listing. Open the posting to read it.'}</p>
        )}
        <p className="mt-3 text-xs text-faint">Shown as published. Check the details on the original posting.</p>
      </div>
    </div>
  )
}

/** Results on the left, the selected listing on the right; on narrow screens the listing opens as a sheet. */
function JobsSplit({
  rows,
  names,
  footer,
  header,
}: {
  rows: Row[]
  names: Record<string, string>
  footer?: ReactNode
  header?: ReactNode
}) {
  const wide = useWide()
  const [savedJobs, setSavedJobs] = useSavedJobs()
  const [dismissed, setDismissed] = useDismissedJobs()
  const [, setJd] = useJobDescription()
  const [selectedId, setSelectedId] = useState('')
  const [sheet, setSheet] = useState(false)
  const selected = rows.find((r) => r.job.id === selectedId) ?? (wide ? rows[0] : undefined)
  const sourceName = (j: Job) => names[j.source] || SOURCE_NAMES[j.source] || j.source
  const savedIds = new Set(savedJobs.map((j) => j.id))
  const dismissedIds = new Set(dismissed.map((j) => j.id))

  function match(job: Job, description: string) {
    if (!description && !job.description) toast('Full description unavailable; using the listing summary')
    const head = [job.title, job.company && `at ${job.company}`, job.location && `(${job.location})`].filter(Boolean).join(' ')
    setJd(`${head}\n${job.url}\n\n${description || job.description || job.snippet}`)
    location.hash = 'match'
  }

  const detail = selected && (
    <JobDetail
      key={selected.job.id}
      row={selected}
      sourceName={sourceName(selected.job)}
      saved={savedIds.has(selected.job.id)}
      dismissed={dismissedIds.has(selected.job.id)}
      onSave={() => {
        setSavedJobs((l) => toggleJob(l, selected.job))
        toast(savedIds.has(selected.job.id) ? 'Removed from saved jobs' : 'Job saved')
      }}
      onDismiss={() => {
        const restoring = dismissedIds.has(selected.job.id)
        setDismissed((l) => toggleJob(l, selected.job))
        toast(restoring ? 'Job restored to results' : 'Job dismissed. Find it under Dismissed.')
        if (!restoring) setSheet(false)
      }}
      onMatch={(d) => match(selected.job, d)}
    />
  )

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-label="Listings">
        {header}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <JobRow
              key={r.job.id}
              row={r}
              sourceName={sourceName(r.job)}
              saved={savedIds.has(r.job.id)}
              selected={!!selected && wide && selected.job.id === r.job.id}
              onSelect={() => {
                setSelectedId(r.job.id)
                if (!wide) setSheet(true)
              }}
            />
          ))}
        </ul>
        {footer}
      </section>
      {wide ? (
        <aside className="rounded-xl border border-line bg-surface p-5 shadow-card lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto" aria-label="Selected listing">
          {detail}
        </aside>
      ) : (
        <Modal open={sheet && !!selected} onClose={() => setSheet(false)} title={selected?.job.company || 'Listing'} width="max-w-2xl">
          {detail}
        </Modal>
      )}
    </div>
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

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/* ---------- Page ---------- */

export default function JobSearch() {
  const [profile] = useProfile()
  const [resume] = useResume()
  const [saved, setSaved] = useStored<SearchParams | null>('jobSearch', null)
  const [form, setForm] = useState<SearchParams>(() => saved ?? { q: (profile?.current_role ?? '').split(/,| at | @ /i)[0].trim(), location: profile?.location ?? '', remote: 'any', excluded: [] })
  const [result, setResult] = useState(lastResult)
  const [loading, setLoading] = useState<'search' | 'more' | null>(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<'relevance' | 'newest'>('relevance')
  const [posted, setPosted] = useState<Posted>('any')
  const [tab, setTab] = useState<Tab>('search')
  const [searches, setSearches] = useSavedSearches()
  const [past, setPast] = usePastSearches()
  const [savedJobs] = useSavedJobs()
  const [dismissed] = useDismissedJobs()
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())
  const [checking, setChecking] = useState(false)

  const resumeWords = useMemo(() => new Set(tokens(`${resume?.text ?? ''} ${(profile?.skills ?? []).join(' ')}`)), [resume, profile])

  async function search(params: SearchParams, page = 1) {
    const q = params.q.trim()
    if (!q) return
    const sources = [...knownEnabled].filter((id) => !params.excluded.includes(id))
    const key = JSON.stringify([q, params.location.trim(), params.remote, params.excluded])
    if (params.excluded.length && knownEnabled.size && !sources.length) {
      lastResult = null
      setResult(null)
      setError('Turn on at least one source.')
      return
    }
    setLoading(page === 1 ? 'search' : 'more')
    setError('')
    try {
      const data = await api.jobSearch({ q, location: params.location, remote: params.remote, page, sources: params.excluded.length ? sources : undefined })
      data.sources.forEach((s) => s.enabled && knownEnabled.add(s.id))
      const prev = page > 1 && result?.key === key ? result.data.jobs : []
      const seen = new Set(prev.map((j) => j.id))
      // Also filtered here: before the first response knownEnabled is empty, so the server searches every source.
      const jobs = [...prev, ...data.jobs.filter((j) => !seen.has(j.id) && !params.excluded.includes(j.source))]
      const at = page > 1 && result ? result.at : new Date().toISOString()
      lastResult = { key, page: page > 1 && jobs.length === prev.length ? MAX_PAGE : page, data: { ...data, jobs }, at }
      setResult(lastResult)
      setSaved({ ...params, q })
      if (page === 1) setPast((l) => addPastSearch(l, { q, location: params.location.trim(), remote: params.remote, excluded: params.excluded, count: jobs.length }))
      markSeen(params, jobs.map((j) => j.id), page > 1)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Search failed. Try again.')
    } finally {
      setLoading(null)
    }
  }

  /** For a saved search: badge the jobs it has not shown before, then remember them as seen. */
  function markSeen(params: SearchParams, ids: string[], more: boolean) {
    const match = searches.find((s) => sameSearch(s, params))
    if (!match) {
      if (!more) setNewIds(new Set())
      return
    }
    const seen = new Set(match.seen)
    const fresh = ids.filter((id) => !seen.has(id))
    setNewIds((prev) => new Set([...(more ? prev : []), ...fresh]))
    setSearches((list) =>
      list.map((s) => (s.id === match.id ? { ...s, seen: [...s.seen, ...fresh].slice(-MAX_SEEN), newCount: 0, checkedAt: new Date().toISOString() } : s)),
    )
  }

  function saveSearch(params: SearchParams = form) {
    const q = params.q.trim()
    if (!q || searches.some((s) => sameSearch(s, params))) return
    const current = result && result.key === JSON.stringify([q, params.location.trim(), params.remote, params.excluded])
    const shown = current ? result.data.jobs.map((j) => j.id) : []
    setSearches((list) => [
      ...list,
      { id: newId(), q, location: params.location.trim(), remote: params.remote, excluded: params.excluded, seen: shown.slice(-MAX_SEEN), newCount: 0, checkedAt: new Date().toISOString() },
    ])
    toast('Search saved. Check it later for new listings.')
  }

  async function checkSaved() {
    setChecking(true)
    const counts = await Promise.all(
      searches.map(async (s) => {
        try {
          const sources = [...knownEnabled].filter((id) => !s.excluded.includes(id))
          const data = await api.jobSearch({ q: s.q, location: s.location, remote: s.remote, sources: s.excluded.length && sources.length ? sources : undefined })
          data.sources.forEach((x) => x.enabled && knownEnabled.add(x.id))
          const seen = new Set(s.seen)
          return { id: s.id, count: new Set(data.jobs.filter((j) => !s.excluded.includes(j.source) && !seen.has(j.id)).map((j) => j.id)).size }
        } catch {
          return null
        }
      }),
    )
    setChecking(false)
    const ok = counts.filter((c) => c !== null)
    const at = new Date().toISOString()
    setSearches((list) =>
      list.map((s) => {
        const c = ok.find((x) => x.id === s.id)
        return c ? { ...s, newCount: c.count, checkedAt: at } : s
      }),
    )
    const total = ok.reduce((n, c) => n + c.count, 0)
    const found = `${total} new ${total === 1 ? 'listing' : 'listings'} found`
    toast(ok.length < counts.length ? `Some searches could not be checked. ${found}.` : found)
  }

  function run(s: Pick<PastSearch, 'q' | 'location' | 'remote' | 'excluded'>) {
    const next: SearchParams = { q: s.q, location: s.location, remote: s.remote, excluded: s.excluded }
    setForm(next)
    setTab('search')
    void search(next)
  }

  const currentSaved = searches.some((s) => sameSearch(s, form))

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

  const names: Record<string, string> = Object.fromEntries((result?.data.sources ?? []).map((s) => [s.id, s.name]))
  const dismissedIds = useMemo(() => new Set(dismissed.map((j) => j.id)), [dismissed])
  const all = useMemo(() => result?.data.jobs ?? [], [result])
  const rows = useMemo(() => {
    const list = all.filter((j) => !dismissedIds.has(j.id) && postedWithin(j, posted)).map((job) => ({ job, fit: quickFit(resumeWords, job), isNew: newIds.has(job.id) }))
    const time = (j: Job) => (j.posted_at ? Date.parse(j.posted_at) || 0 : 0)
    return list.sort((a, b) => (sort === 'relevance' ? (b.fit ?? 0) - (a.fit ?? 0) : 0) || time(b.job) - time(a.job))
  }, [all, resumeWords, sort, posted, dismissedIds, newIds])
  const hiddenCount = all.length - rows.length
  const sourceList = (result?.data.sources ?? []).filter((s) => s.ok && s.count > 0).map((s) => s.name || SOURCE_NAMES[s.id] || s.id)
  const toRows = (list: Job[]) => list.map((job) => ({ job, fit: quickFit(resumeWords, job) }))

  const listHeader = result && (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <p className="min-w-0 text-[13px] text-muted">
        <span className="t-num font-medium text-ink">{rows.length}</span> {rows.length === 1 ? 'posting' : 'postings'}
        {sourceList.length > 0 && ` from ${sourceList.join(', ')}`} · searched {relative(result.at)}
        {hiddenCount > 0 && ` · ${hiddenCount} hidden by filters or dismissed`}
      </p>
      <div className="flex items-center gap-2">
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
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={loading === 'search'} onClick={() => search(saved ?? form)}>
          Search again
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title="Job search" description="Search live listings from job boards and company career pages, then save, match or apply." />

      <Segmented
        label="Job search sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'past', label: 'Past searches', count: past.length + searches.length },
          { value: 'saved', label: 'Saved', count: savedJobs.length },
          { value: 'dismissed', label: 'Dismissed', count: dismissed.length },
        ]}
      />

      {tab === 'search' && (
        <>
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
              <div className="flex gap-2">
                <Button type="submit" variant="brand" icon={Search} loading={loading === 'search'} disabled={!form.q.trim()}>
                  Search
                </Button>
                <Button variant="secondary" icon={BookmarkPlus} onClick={() => saveSearch()} disabled={!form.q.trim() || currentSaved}>
                  {currentSaved ? 'Saved' : 'Save search'}
                </Button>
              </div>
            </form>

            {result && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <span className="t-overline mr-1">Sources</span>
                {result.data.sources.map((s) => (
                  <SourceChip key={s.id} source={s} on={!form.excluded.includes(s.id)} onToggle={() => toggleSource(s.id)} />
                ))}
                <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
                  Posted
                  <select className={`${inputCls} w-36`} value={posted} onChange={(e) => setPosted(e.target.value as Posted)}>
                    {POSTED.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
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
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX />}
                title={all.length ? 'Every listing is filtered out' : 'No listings found'}
                text={all.length ? 'Widen the posted date, or restore listings you dismissed.' : 'Try broader keywords, another location, or a different work mode.'}
                action={
                  all.length && posted !== 'any' ? (
                    <Button variant="secondary" onClick={() => setPosted('any')}>
                      Show any posting date
                    </Button>
                  ) : form.location.trim() ? (
                    <Button
                      variant="secondary"
                      icon={Search}
                      onClick={() => {
                        const next = { ...form, location: '' }
                        setForm(next)
                        void search(next)
                      }}
                    >
                      Search without location
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <JobsSplit
              rows={rows}
              names={names}
              header={listHeader}
              footer={
                result.page < MAX_PAGE && (
                  <div className="flex justify-center border-t border-line px-4 py-3">
                    <Button variant="secondary" loading={loading === 'more'} onClick={() => search(saved ?? form, result.page + 1)}>
                      Show more
                    </Button>
                  </div>
                )
              }
            />
          )}
        </>
      )}

      {tab === 'past' && (
        <>
          <Card
            title="Saved searches"
            description="Check them for listings you have not seen yet."
            padding={false}
            divider
            action={
              searches.length > 0 && (
                <Button size="sm" variant="secondary" icon={BellRing} loading={checking} onClick={checkSaved}>
                  Check saved searches
                </Button>
              )
            }
          >
            {searches.length ? (
              <ul className="divide-y divide-line">
                {searches.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="t-title block truncate">{s.q}</span>
                      <span className="block truncate text-xs text-muted">{describe(s)}</span>
                    </div>
                    {s.newCount > 0 ? (
                      <Badge tone="accent" mono>
                        {s.newCount} new since {s.checkedAt ? relative(s.checkedAt) : 'last run'}
                      </Badge>
                    ) : (
                      s.checkedAt && <span className="text-xs text-faint">No new listings since {relative(s.checkedAt)}</span>
                    )}
                    <Button size="sm" variant="ghost" icon={Play} onClick={() => run(s)} aria-label={`Run saved search ${s.q}`}>
                      Run
                    </Button>
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label={`Delete saved search ${s.q}`}
                      className="hover:bg-danger-bg hover:text-danger"
                      onClick={() => setSearches((list) => list.filter((x) => x.id !== s.id))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">Save a search to check it for new listings later.</p>
            )}
          </Card>

          <Card
            title="Recent searches"
            description="The last 20 searches you ran in this browser."
            padding={false}
            divider
            action={
              past.length > 0 && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setPast([])}>
                  Clear
                </Button>
              )
            }
          >
            {past.length ? (
              <ul className="divide-y divide-line">
                {past.map((s) => {
                  const isSaved = searches.some((x) => sameSearch(x, s))
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                      <History className="size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <span className="t-title block truncate">{s.q}</span>
                        <span className="block truncate text-xs text-muted">
                          {describe(s)} · {s.count} {s.count === 1 ? 'posting' : 'postings'} · {when(s.at)}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" icon={BookmarkPlus} disabled={isSaved} onClick={() => saveSearch(s)}>
                        {isSaved ? 'Saved' : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" icon={Play} onClick={() => run(s)} aria-label={`Run search ${s.q}`}>
                        Run
                      </Button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">No searches yet.</p>
            )}
          </Card>
        </>
      )}

      {tab === 'saved' &&
        (savedJobs.length ? (
          <JobsSplit rows={toRows(savedJobs)} names={names} />
        ) : (
          <Card>
            <EmptyState icon={<Bookmark />} title="No saved jobs" text="Save listings from your search results to come back to them. They stay here after the search is gone." />
          </Card>
        ))}

      {tab === 'dismissed' &&
        (dismissed.length ? (
          <JobsSplit rows={toRows(dismissed)} names={names} />
        ) : (
          <Card>
            <EmptyState icon={<EyeOff />} title="Nothing dismissed" text="Dismissed listings are hidden from your results. Restore them here at any time." />
          </Card>
        ))}
    </>
  )
}
