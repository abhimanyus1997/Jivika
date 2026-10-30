import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Application, Point } from '../lib/store'

/*
 * Chart palette, validated for CVD separation in this stacking order
 * (amber | indigo | rose). Amber is below 3:1 on white, so the trends
 * chart always ships a legend and a table view.
 */
export const SERIES = [
  { key: 'awaiting', label: 'Awaiting response', color: '#F59E0B' },
  { key: 'received', label: 'Response received', color: '#4F46E5' },
  { key: 'rejected', label: 'Rejected', color: '#F43F5E' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

const INK = { muted: '#64748B', grid: '#E2E8F0', accent: '#4F46E5', recede: '#C7D2FE' }

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function TipBox({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-slate-500">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color && <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden="true" />}
          <span className="font-semibold tabular-nums text-slate-900">{r.value}</span>
          <span className="text-slate-500">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Seven-bar history sparkline for a metric card. Latest value in the accent, history recedes. */
export function MiniBars({ points, label }: { points: Point[]; label: string }) {
  const recent = points.slice(-7).map((p) => ({ value: p.value, name: shortDate(p.date) }))
  // Left-pad to seven slots so bar width and position match across cards.
  const data: { value: number | null; name: string }[] = [
    ...Array.from({ length: 7 - recent.length }, () => ({ value: null, name: '' })),
    ...recent,
  ]
  return (
    <div className="h-10 w-24" role="img" aria-label={`${label}, last ${recent.length} values: ${recent.map((d) => d.value).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) =>
              active && payload?.length && payload[0].value != null ? (
                <TipBox
                  title={(payload[0].payload as { name: string }).name}
                  rows={[{ label, value: payload[0].value as number }]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={10} isAnimationActive={false}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === data.length - 1 ? INK.accent : INK.recede} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const WEEKS = 8

function weekStart(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7)) // Monday
  return s
}

function bucket(status: Application['status']): SeriesKey {
  if (status === 'Rejected') return 'rejected'
  if (status === 'Applied' || status === 'Awaiting response') return 'awaiting'
  return 'received'
}

type WeekRow = { week: string } & Record<SeriesKey, number> & { total: number }

export function weeklyTrends(apps: Application[]): WeekRow[] {
  const current = weekStart(new Date())
  const rows: WeekRow[] = []
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = new Date(current)
    start.setDate(start.getDate() - i * 7)
    rows.push({ week: shortDate(start.toISOString()), awaiting: 0, received: 0, rejected: 0, total: 0 })
  }
  for (const app of apps) {
    const [y, m, d] = app.date.split('-').map(Number)
    if (!y) continue
    const diff = Math.round((current.getTime() - weekStart(new Date(y, m - 1, d)).getTime()) / (7 * 864e5))
    if (diff < 0 || diff >= WEEKS) continue
    const row = rows[WEEKS - 1 - diff]
    row[bucket(app.status)]++
    row.total++
  }
  return rows
}

/** Stacked segment with a 2px surface gap below it and a rounded end only on the top segment. */
function segmentShape(index: number) {
  return function Segment(props: unknown) {
    const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: WeekRow }
    const keys = SERIES.map((s) => s.key)
    const below = keys.slice(0, index).some((k) => payload[k] > 0)
    const above = keys.slice(index + 1).some((k) => payload[k] > 0)
    const h = height - (below ? 2 : 0)
    if (!(h > 0) || !(width > 0)) return <g />
    const fill = SERIES[index].color
    if (above) return <rect x={x} y={y} width={width} height={h} fill={fill} />
    const r = Math.min(4, h, width / 2)
    return (
      <path
        fill={fill}
        d={`M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + h}Z`}
      />
    )
  }
}

export function ApplicationTrends({ applications }: { applications: Application[] }) {
  const rows = useMemo(() => weeklyTrends(applications), [applications])
  const [table, setTable] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-4 text-xs text-slate-600" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setTable(!table)}
          className="text-xs font-medium text-indigo-700 hover:underline"
          aria-pressed={table}
        >
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {table ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Applications by week</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Week of</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.week} className="border-b border-slate-100">
                  <td className="py-1.5">{r.week}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1.5 text-right">
                      {r[s.key]}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-medium">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56" role="img" aria-label="Stacked bar chart of applications per week by status. Use Show table for values.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.muted, fontSize: 11 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: INK.muted, fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: '#F1F5F9' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <TipBox
                      title={`Week of ${label}`}
                      rows={[...SERIES]
                        .reverse()
                        .map((s) => ({ label: s.label, value: (payload[0].payload as WeekRow)[s.key], color: s.color }))}
                    />
                  ) : null
                }
              />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="status"
                  fill={s.color}
                  maxBarSize={24}
                  shape={segmentShape(i)}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
