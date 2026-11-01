import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Application, Point } from '../lib/store'

/*
 * Chart palette, validated for CVD separation in this order (evergreen | marigold).
 * Marigold is below 3:1 on white, so the weekly chart always ships a legend and a table view.
 * Colors are CSS variables: index.css swaps in dark steps, validated against the dark surface.
 */
export const SERIES = [
  { key: 'started', label: 'Started', color: 'var(--color-series-1)' },
  { key: 'sent', label: 'Sent', color: 'var(--color-series-2)' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

const INK = {
  muted: 'var(--color-faint)',
  grid: 'var(--color-line)',
  accent: 'var(--color-brand-500)',
  recede: 'var(--color-line-strong)',
  hover: 'var(--color-subtle)',
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function TipBox({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 text-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color && <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden="true" />}
          <span className="t-num font-medium text-ink">{r.value}</span>
          <span className="text-muted">{r.label}</span>
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
    <div className="h-8 w-20 shrink-0" role="img" aria-label={`${label}, last ${recent.length} values: ${recent.map((d) => d.value).join(', ')}`}>
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

function weekStart(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7)) // Monday
  return s
}

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return y ? new Date(y, m - 1, d) : null
}

type App = Application & { created?: string; sent?: string }

/** When the application was started: the created date, or the tracked date for older entries. */
export const startedOn = (a: Application) => (a as App).created || a.date
/** When it was sent: the sent date, the first non-draft status change, or the tracked date. Empty for drafts. */
export function sentOn(a: Application): string {
  const x = a as App
  if (String(a.status) === 'Draft') return ''
  return x.sent || (a.history ?? []).find((h) => String(h.status) !== 'Draft')?.date || a.date
}

type WeekRow = { week: string } & Record<SeriesKey, number>

/** Started vs sent per week, oldest first, covering `weeks` weeks up to this one. */
export function weeklyTrends(apps: Application[], weeks = 8): WeekRow[] {
  const current = weekStart(new Date())
  const rows: WeekRow[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(current)
    start.setDate(start.getDate() - i * 7)
    rows.push({ week: shortDate(start.toISOString()), started: 0, sent: 0 })
  }
  const add = (iso: string, key: SeriesKey) => {
    const day = parseDay(iso)
    if (!day) return
    const diff = Math.round((current.getTime() - weekStart(day).getTime()) / (7 * 864e5))
    if (diff >= 0 && diff < weeks) rows[weeks - 1 - diff][key]++
  }
  for (const a of apps) {
    add(startedOn(a), 'started')
    const s = sentOn(a)
    if (s) add(s, 'sent')
  }
  return rows
}

/** Legend chips for the weekly series. */
function TrendsLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

/** Weekly grouped bars, started vs sent, from weeklyTrends(). `view` is controlled by the caller. */
export function ApplicationTrends({ rows, view }: { rows: WeekRow[]; view: 'chart' | 'table' }) {
  return (
    <div className="space-y-4">
      <TrendsLegend />
      {view === 'table' ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Applications started and sent by week</caption>
            <thead>
              <tr>
                <th>Week of</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.week}>
                  <td className="t-num text-muted">{r.week}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="num">
                      {r[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56" role="img" aria-label="Bar chart of applications started and sent per week. Switch to the table view for values.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -20 }} barGap={2}>
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.muted, fontSize: 11 }} minTickGap={8} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: INK.muted, fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: INK.hover }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <TipBox
                      title={`Week of ${label}`}
                      rows={SERIES.map((s) => ({ label: s.label, value: (payload[0].payload as WeekRow)[s.key], color: s.color }))}
                    />
                  ) : null
                }
              />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={14} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
