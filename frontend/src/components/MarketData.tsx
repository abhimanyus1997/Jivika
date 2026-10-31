import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Currency, type SalaryRange, type SalaryResult } from '../lib/api'
import { Badge, Skeleton } from './ui'

// ponytail: per-page-load cache so revisiting a page does not refetch; the server caches for 6 h too.
const cache = new Map<string, Promise<SalaryResult>>()

function lookup(title: string, location: string, company: string, currency: Currency) {
  const key = [title, location, company, currency].join('|').toLowerCase()
  let hit = cache.get(key)
  if (!hit) {
    hit = api.salary({ title, location, company, currency })
    hit.catch(() => cache.delete(key)) // let a later visit retry
    cache.set(key, hit)
  }
  return hit
}

/** ₹12L, $120K: compact, in the range's own currency (no conversion). */
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`
  }
}

function Range({ r }: { r: SalaryRange }) {
  const meta = [r.source_name, r.sample_size ? `${r.sample_size} ${r.sample_size === 1 ? 'sample' : 'samples'}` : '', r.as_of ? `as of ${r.as_of}` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-num text-[13px] font-medium text-ink">
          {money(r.min, r.currency)} – {money(r.max, r.currency)}
        </span>
        {r.median ? <span className="t-num text-xs text-muted">median {money(r.median, r.currency)}</span> : null}
        <Badge tone="info">Market data</Badge>
        {r.research && <Badge variant="outline">Research</Badge>}
      </div>
      <p className="mt-0.5 text-xs leading-4 text-faint">
        {r.label}
        {meta && ` · ${meta}`}
        {r.url && (
          <>
            {' · '}
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
              Source
            </a>
          </>
        )}
      </p>
    </li>
  )
}

/** Market salary ranges for a role, with a Levels.fyi link. Shown next to AI estimates. */
export function MarketData({
  title,
  location = '',
  company = '',
  currency = 'INR',
}: {
  title: string
  location?: string
  company?: string
  currency?: Currency
}) {
  const [state, setState] = useState<{ key: string; data?: SalaryResult; error?: string } | null>(null)
  const key = [title, location, company, currency].join('|')

  useEffect(() => {
    if (!title.trim()) return
    let live = true
    lookup(title, location, company, currency).then(
      (data) => live && setState({ key, data }),
      (e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : 'Market data is unavailable.' }),
    )
    return () => {
      live = false
    }
  }, [key, title, location, company, currency])

  if (!title.trim()) return null
  const current = state?.key === key ? state : null
  const ranges = current?.data?.ranges ?? []

  return (
    <div className="mt-2 rounded-lg border border-line bg-canvas px-3 py-2">
      <div className="t-overline mb-1.5">Market data</div>
      {!current ? (
        <div role="status" aria-label="Loading market data" className="space-y-1.5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
      ) : current.error ? (
        <p className="text-xs text-muted">{current.error}</p>
      ) : ranges.length ? (
        <ul className="space-y-2">
          {ranges.map((r) => (
            <Range key={`${r.source}-${r.currency}`} r={r} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No market data found for this role{location ? ` in ${location}` : ''}.</p>
      )}
      {current?.data?.levels_url && (
        <a
          href={current.data.levels_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
        >
          View on Levels.fyi <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden="true" />
        </a>
      )}
    </div>
  )
}
