import { useId } from 'react'
import { normStatus, type Application } from '../lib/store'

const STAGES = ['Sent', 'Screening', 'Interview', 'Offer', 'Accepted'] as const
const RANK: Record<string, number> = { Applied: 0, Screening: 1, Interview: 2, Offer: 3, Declined: 3, Accepted: 4 }

type Outcome = 'open' | 'rejected' | 'withdrawn' | 'declined'
const OUTCOME_COLOR: Record<Outcome, string> = {
  open: 'var(--color-series-neutral)',
  rejected: 'var(--color-series-3)',
  withdrawn: 'var(--color-series-2)',
  declined: 'var(--color-series-2)',
}
const OPEN_LABEL = ['waiting', 'waiting', 'in progress', 'deciding']

export const isSent = (a: Application) => normStatus(a.status) !== 'Draft'

export function funnelData(apps: Application[]) {
  const sent = apps.filter(isSent)
  const reach = sent.map((a) => Math.max(0, ...[a.status, ...(a.history ?? []).map((h) => h.status)].map((s) => RANK[normStatus(s)] ?? 0)))
  const counts = STAGES.map((_, k) => reach.filter((r) => r >= k).length)
  const drops = STAGES.slice(0, -1).map((_, k) => {
    const by: Record<Outcome, number> = { open: 0, rejected: 0, withdrawn: 0, declined: 0 }
    sent.forEach((a, i) => {
      if (reach[i] !== k) return
      const s = normStatus(a.status)
      by[s === 'Rejected' ? 'rejected' : s === 'Withdrawn' ? 'withdrawn' : s === 'Declined' ? 'declined' : 'open']++
    })
    return (Object.keys(by) as Outcome[])
      .filter((o) => by[o] > 0)
      .map((o) => ({ outcome: o, count: by[o], label: `${by[o]} ${o === 'open' ? OPEN_LABEL[k] : o}` }))
  })
  // A rejection is still a reply.
  const heardBack = sent.filter((a, i) => reach[i] >= 1 || ['Rejected', 'Declined'].includes(normStatus(a.status))).length
  return { sent: sent.length, counts, drops, heardBack, interviews: counts[2] }
}

export type FunnelData = ReturnType<typeof funnelData>

export function funnelSummary(d: FunnelData) {
  const parts = STAGES.map((s, k) => `${d.counts[k]} ${k === 0 ? 'sent' : `reached ${s.toLowerCase()}`}`)
  return `Application flow: ${parts.join(', ')}.`
}

const W = 680
const TOP = 28
const MAIN = 110
const NODE = 10

const band = (x0: number, a0: number, a1: number, x1: number, b0: number, b1: number) => {
  const xm = (x0 + x1) / 2
  return `M${x0},${a0}C${xm},${a0} ${xm},${b0} ${x1},${b0}L${x1},${b1}C${xm},${b1} ${xm},${a1} ${x0},${a1}Z`
}

function layout(data: FunnelData) {
  const scale = MAIN / Math.max(1, data.sent)
  const h = (c: number) => (c ? Math.max(3, c * scale) : 0)
  const step = (W - NODE - 90) / (STAGES.length - 1)
  const x = (k: number) => k * step
  let bottom = TOP + MAIN
  const branches = data.drops.flatMap((list, k) => {
    let cursor = TOP + h(data.counts[k + 1])
    let endY = TOP + h(data.counts[k]) + 22
    return list.map((d) => {
      const t = h(d.count)
      const x0 = x(k) + NODE
      const x1 = x(k) + step * 0.55
      const path = band(x0, cursor, cursor + t, x1, endY, endY + t)
      const item = { key: `${k}-${d.outcome}`, path, color: OUTCOME_COLOR[d.outcome], label: d.label, lx: x1 + 6, ly: endY + t / 2, x1, endY, t }
      cursor += t
      endY += t + 18
      bottom = Math.max(bottom, endY)
      return item
    })
  })
  const height = bottom + 6
  return { h, x, branches, height }
}

/** Sankey-style flow: stages left to right, drop-offs branch downward with their counts. */
export function FunnelFlow({ data }: { data: FunnelData }) {
  const uid = useId()
  const { h, x, branches, height } = layout(data)

  return (
    <svg viewBox={`-2 0 ${W} ${height}`} className="w-full" role="img" aria-labelledby={`${uid}t`}>
      <title id={`${uid}t`}>
        {funnelSummary(data)} {data.drops.flat().map((d) => d.label).join(', ')}.
      </title>
      {STAGES.slice(0, -1).map((_, k) =>
        data.counts[k + 1] ? (
          <path
            key={k}
            d={band(x(k) + NODE, TOP, TOP + h(data.counts[k + 1]), x(k + 1), TOP, TOP + h(data.counts[k + 1]))}
            fill="var(--color-series-1)"
            opacity={0.28}
          />
        ) : null,
      )}
      {branches.map((b) => (
        <g key={b.key}>
          <path d={b.path} fill={b.color} opacity={0.45} />
          <rect x={b.x1} y={b.endY} width={3} height={b.t} rx={1} fill={b.color} />
          <text x={b.lx} y={b.ly} dominantBaseline="middle" fontSize={12} fill="var(--color-muted)">
            {b.label}
          </text>
        </g>
      ))}
      {STAGES.map((s, k) => (
        <g key={s}>
          {data.counts[k] > 0 && <rect x={x(k)} y={TOP} width={NODE} height={h(data.counts[k])} rx={2} fill="var(--color-series-1)" />}
          {data.counts[k] === 0 && <rect x={x(k)} y={TOP} width={NODE} height={2} fill="var(--color-line-strong)" />}
          <text x={x(k)} y={TOP - 10} fontSize={12} fill="var(--color-ink)" fontWeight={500}>
            {s}{' '}
            <tspan fill="var(--color-muted)" fontWeight={400}>
              {data.counts[k]}
            </tspan>
          </text>
        </g>
      ))}
    </svg>
  )
}

/** The same numbers as a table, for the 'Show the numbers' toggle. */
export function FunnelTable({ data }: { data: FunnelData }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Applications reaching each stage</caption>
        <thead>
          <tr>
            <th>Stage</th>
            <th className="text-right">Reached</th>
            <th className="text-right">Of previous</th>
            <th>Stopped here</th>
          </tr>
        </thead>
        <tbody>
          {STAGES.map((s, k) => (
            <tr key={s}>
              <td>{s}</td>
              <td className="num">{data.counts[k]}</td>
              <td className="num text-muted">{k && data.counts[k - 1] ? `${Math.round((data.counts[k] / data.counts[k - 1]) * 100)}%` : '-'}</td>
              <td className="text-muted">{data.drops[k]?.map((d) => d.label).join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
