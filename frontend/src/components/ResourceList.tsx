import { BookOpen, CirclePlay, CodeXml, FileText, GraduationCap, Map as MapIcon, MessagesSquare, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type Resource, type ResourceKind, type ResourceQuery } from '../lib/api'
import { useStored } from '../lib/store'
import { Badge, Skeleton } from './ui'

const KINDS: Record<ResourceKind, { icon: LucideIcon; label: string }> = {
  course: { icon: GraduationCap, label: 'Course' },
  video: { icon: CirclePlay, label: 'Video' },
  discussion: { icon: MessagesSquare, label: 'Discussion' },
  article: { icon: FileText, label: 'Article' },
  docs: { icon: BookOpen, label: 'Docs' },
  practice: { icon: CodeXml, label: 'Practice' },
  roadmap: { icon: MapIcon, label: 'Roadmap' },
}
const REQUEST_KINDS = new Set<string>(['course', 'video', 'discussion', 'article', 'docs', 'practice'])
const MAX_ITEMS = 20 // server cap per request
const PER_STEP = 3

/** Search queries per step, keyed like 'plan-0', 'roadmap-<itemId>', 'skill-<n>'. */
export type ResourceGroups = Record<string, ResourceQuery[] | undefined>

export interface ResourcesState {
  results: Record<string, Resource[]>
  loading: boolean
  /** Some or all search sources failed, so lists may be short. */
  degraded: boolean
  /** Keys that had queries (a step without queries shows nothing). */
  asked: Set<string>
}

interface Cached {
  sig: string
  results: Record<string, Resource[]>
  degraded: boolean
}

function clean(groups: ResourceGroups) {
  const out: [string, ResourceQuery[]][] = []
  for (const [key, qs] of Object.entries(groups)) {
    const valid = (qs ?? [])
      .filter((q) => q && typeof q.query === 'string' && q.query.trim() && REQUEST_KINDS.has(q.kind))
      .slice(0, PER_STEP)
      .map((q) => ({ query: q.query.trim().slice(0, 80), kind: q.kind }))
    if (valid.length) out.push([key.slice(0, 60), valid])
  }
  return out
}

// One request per distinct query set per page load, even across StrictMode double effects and remounts.
const inflight = new Map<string, Promise<Cached>>()

async function resolve(sig: string, groups: [string, ResourceQuery[]][]): Promise<Cached> {
  // Each query gets its own sub-key; first queries of every step go first so a step is never left out.
  const items: { key: string; query: string; kind: ResourceQuery['kind'] }[] = []
  for (let i = 0; i < PER_STEP; i++) for (const [key, qs] of groups) if (qs[i]) items.push({ key: `${key}~${i}`, ...qs[i] })
  const chunks: (typeof items)[] = []
  for (let i = 0; i < items.length; i += MAX_ITEMS) chunks.push(items.slice(i, i + MAX_ITEMS))
  const replies = await Promise.all(chunks.map((c) => api.resolveResources(c).catch(() => null)))

  const sub: Record<string, Resource[]> = {}
  let degraded = false
  for (const r of replies) {
    if (!r) {
      degraded = true
      continue
    }
    Object.assign(sub, r.results)
    if (r.sources?.some((s) => !s.ok)) degraded = true
  }
  const results: Record<string, Resource[]> = {}
  for (const [key, qs] of groups) {
    const lists = qs.map((_, i) => (sub[`${key}~${i}`] ?? []).filter((x) => x?.url?.startsWith('https://')))
    const seen = new Set<string>()
    const merged: Resource[] = []
    // Interleave so the step mixes kinds (a course, a video, a discussion) before repeating one.
    for (let i = 0; merged.length < PER_STEP && lists.some((l) => l.length > i); i++) {
      for (const l of lists) {
        const r = l[i]
        if (r && !seen.has(r.url) && merged.length < PER_STEP) {
          seen.add(r.url)
          merged.push(r)
        }
      }
    }
    results[key] = merged.sort((a, b) => Number(b.verified) - Number(a.verified))
  }
  return { sig, results, degraded }
}

/** Short stable fingerprint of the queries, to tell whether the cached links belong to this result. */
function hash(text: string) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Resolves every step's queries in one go (one request, or a few for very long plans) and caches the
 * links in localStorage under `scope`, alongside the result they belong to.
 */
export function useResources(scope: string, groups: ResourceGroups): ResourcesState {
  // Callers build `groups` inline, so key the memo on its content.
  const groupsJson = JSON.stringify(groups)
  const cleaned = useMemo(() => clean(JSON.parse(groupsJson) as ResourceGroups), [groupsJson])
  const sig = useMemo(() => hash(JSON.stringify(cleaned)), [cleaned])
  const [cached, setCached] = useStored<Cached | null>(`resources.${scope}`, null)
  const [failed, setFailed] = useState('')
  const hit = cached?.sig === sig ? cached : null
  const loading = !!cleaned.length && !hit && failed !== sig

  useEffect(() => {
    if (!loading) return
    let live = true
    let p = inflight.get(sig)
    if (!p) {
      p = resolve(sig, cleaned)
      inflight.set(sig, p)
    }
    p.then((r) => {
      if (!live) return
      // Only a fully failed run is kept out of storage, so a later visit can try again.
      if (Object.values(r.results).some((l) => l.length) || !r.degraded) setCached(r)
      else setFailed(sig)
    })
    return () => {
      live = false
    }
  }, [loading, sig, cleaned, setCached])

  return useMemo(
    () => ({
      results: hit?.results ?? {},
      loading,
      degraded: hit ? hit.degraded : failed === sig,
      asked: new Set(cleaned.map(([k]) => k)),
    }),
    [hit, loading, failed, sig, cleaned],
  )
}

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ResourceRow({ r }: { r: Resource }) {
  const kind = KINDS[r.kind] ?? KINDS.article
  const Icon = kind.icon
  const checked = formatDate(r.checked_at)
  const meta = [r.provider, kind.label.toLowerCase(), r.author, r.domain].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted" title={kind.label}>
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{kind.label}:</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 text-[13px] leading-5 font-medium break-words text-brand-600 hover:underline"
          >
            {r.title || r.domain}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Badge tone={r.verified ? 'brand' : 'neutral'} variant={r.verified ? 'soft' : 'outline'}>
            {r.verified ? 'Verified' : 'From search'}
          </Badge>
        </div>
        <p className="truncate text-xs leading-4 text-muted">{meta}</p>
        <p className="mt-0.5 text-xs leading-4 text-faint">
          {r.verified || !r.note
            ? `Found via ${r.found_via}${checked ? ` · link checked ${checked}` : ''}`
            : `Found via ${r.found_via} · ${r.note}`}
        </p>
      </div>
    </li>
  )
}

/** The links for one step. Renders nothing for steps that had no queries. */
export function ResourceList({ state, id, className = 'mt-3' }: { state: ResourcesState; id: string; className?: string }) {
  if (!state.asked.has(id.slice(0, 60))) return null
  const list = state.results[id.slice(0, 60)] ?? []
  return (
    <div className={`rounded-lg border border-line bg-canvas p-3 ${className}`}>
      <h4 className="t-overline mb-2">Learning resources</h4>
      {state.loading ? (
        <div className="space-y-3" role="status" aria-label="Finding learning resources">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="size-6 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length ? (
        <ul className="divide-y divide-line">
          {list.map((r) => (
            <ResourceRow key={r.url} r={r} />
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-4 text-muted">
          {state.degraded
            ? 'Fewer resources found: some search sources did not respond. Try again later.'
            : 'No checked resources found for this step.'}
        </p>
      )}
    </div>
  )
}

/** Attribution under a plan that shows resources. */
export function ResourceFooter({ state, prefix = '' }: { state: ResourcesState; prefix?: string }) {
  const keys = [...state.asked].filter((k) => k.startsWith(prefix))
  if (!keys.length) return null
  // A failed source only matters to the reader when it left a step short.
  const short = state.degraded && !state.loading && keys.some((k) => (state.results[k]?.length ?? 0) < 2)
  return (
    <p className="border-t border-line pt-3 text-xs text-faint">
      Resources link to third-party sites; their content belongs to the respective publishers.
      {short && ' Some search sources were unavailable, so fewer resources were found.'}
    </p>
  )
}
