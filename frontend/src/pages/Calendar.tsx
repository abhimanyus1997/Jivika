import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, ExternalLink, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ImportDialog } from '../components/ImportDialog'
import { Badge, Button, ButtonLink, Card, EmptyState, Field, IconButton, Modal, Note, PageHeader, inputCls, textareaCls, toast } from '../components/ui'
import {
  COUNTRIES,
  DAY_OFF_LABEL,
  countryFromLocation,
  type DayOff,
  type DayOffKind,
  type OffMap,
  calendarYears,
  importHolidayFile,
  isWeekend,
  nextWorkingDay,
  offReason,
  regionsOf,
  useDaysOff,
  useHolidayImports,
  useHolidays,
  useHolidaySettings,
  useOffDays,
} from '../lib/holidays'
import {
  KIND_LABEL,
  addDays,
  calendarEntries,
  dayLabel,
  downloadIcs,
  googleCalendarUrl,
  iso,
  parseDay as parse,
  type AllDayEvent,
  type CalEntry,
  type EntryDraft as Draft,
  type EntryKind,
  saveEntry,
} from '../lib/ics'
import { newId, today, useApplications, useProfile, type Application } from '../lib/store'

const KIND_DOT: Record<EntryKind, string> = { interview: 'bg-accent-500', followup: 'bg-info', deadline: 'bg-danger' }
const KIND_TONE = { interview: 'accent', followup: 'info', deadline: 'danger' } as const

const fileName = (e: CalEntry) => `${(e.company || 'jivika').replace(/[^\w-]+/g, '-').toLowerCase()}-${e.kind}-${e.date}.ics`

/** Month grid with a dot per entry kind and muted holiday labels. Days are buttons when onSelect is given. */
export function MonthGrid({
  entries,
  month,
  onMonth,
  selected,
  onSelect,
  compact = false,
  off,
}: {
  entries: CalEntry[]
  month: string // yyyy-mm-01
  onMonth: (m: string) => void
  selected?: string
  onSelect?: (day: string) => void
  compact?: boolean
  off?: OffMap
}) {
  const first = parse(month)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7)) // Monday on or before the 1st
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return iso(d)
  })
  const rows = days[35].slice(0, 7) === month.slice(0, 7) ? 6 : 5
  const byDay = useMemo(() => {
    const m = new Map<string, CalEntry[]>()
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [entries])
  const shift = (n: number) => onMonth(iso(new Date(first.getFullYear(), first.getMonth() + n, 1)))
  const now = today()
  const weekdays = Array.from({ length: 7 }, (_, i) => parse(days[i]).toLocaleDateString(undefined, { weekday: 'narrow' }))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink" aria-live="polite">
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-1">
          {!compact && (
            <Button size="sm" variant="ghost" onClick={() => onMonth(now.slice(0, 8) + '01')}>
              Today
            </Button>
          )}
          <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={() => shift(-1)} />
          <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={() => shift(1)} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {weekdays.map((w, i) => (
          <div key={i} className="t-overline py-1" aria-hidden="true">
            {w}
          </div>
        ))}
        {days.slice(0, rows * 7).map((d) => {
          const list = byDay.get(d) ?? []
          const hols = off?.get(d) ?? []
          const dayOff = hols.some((h) => h.off)
          const kinds = [...new Set(list.map((e) => e.kind))]
          const inMonth = d.slice(0, 7) === month.slice(0, 7)
          const isToday = d === now
          const cls = `relative flex min-w-0 flex-col items-center justify-start rounded-md ${compact ? 'h-9 pt-1' : 'h-16 pt-1.5'} text-[13px] ${
            inMonth ? 'text-ink' : 'text-faint'
          } ${selected === d ? 'bg-brand-50 ring-1 ring-brand-200' : `${dayOff ? 'bg-subtle' : ''} ${onSelect ? 'hover:bg-subtle' : ''}`}`
          const body = (
            <>
              <span className={`t-num flex size-6 items-center justify-center rounded-full ${isToday ? 'bg-brand-600 font-medium text-white' : ''}`}>
                {parse(d).getDate()}
              </span>
              {kinds.length > 0 && (
                <span className="mt-0.5 flex gap-0.5" aria-hidden="true">
                  {kinds.map((k) => (
                    <span key={k} className={`size-1.5 rounded-full ${KIND_DOT[k]}`} />
                  ))}
                </span>
              )}
              {!compact && hols.length > 0 && (
                <span className="mt-auto mb-1 w-full truncate px-1 text-[10px] leading-3 text-muted" aria-hidden="true">
                  {hols[0].name}
                  {hols.length > 1 ? ` +${hols.length - 1}` : ''}
                </span>
              )}
            </>
          )
          const label = [
            dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' }),
            ...hols.map((h) => h.name),
            ...(list.length ? [`${list.length} ${list.length === 1 ? 'entry' : 'entries'}`] : []),
          ].join(', ')
          return onSelect ? (
            <button key={d} type="button" className={cls} aria-label={label} title={hols.map((h) => h.name).join(', ') || undefined} aria-pressed={selected === d} onClick={() => onSelect(d)}>
              {body}
            </button>
          ) : (
            <div key={d} className={cls} title={label}>
              <span className="sr-only">{label}</span>
              <span aria-hidden="true" className="contents">
                {body}
              </span>
            </div>
          )
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Legend">
        {(Object.keys(KIND_DOT) as EntryKind[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${KIND_DOT[k]}`} aria-hidden="true" />
            {KIND_LABEL[k]}
          </li>
        ))}
        {off && off.size > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-line bg-subtle" aria-hidden="true" />
            Holiday or day off
          </li>
        )}
      </ul>
    </div>
  )
}

/** Entries grouped by day, with holiday labels. Actions are optional so the dashboard can show a compact list. */
export function Agenda({
  entries,
  empty,
  actions = false,
  onEdit,
  onToggleDone,
  onMove,
  off,
  extraDays = [],
}: {
  entries: CalEntry[]
  empty: string
  actions?: boolean
  onEdit?: (e: CalEntry) => void
  onToggleDone?: (e: CalEntry) => void
  /** Moves a follow-up to another date (used to skip weekends and holidays). */
  onMove?: (e: CalEntry, date: string) => void
  off?: OffMap
  /** Days shown for their holidays even without entries. */
  extraDays?: string[]
}) {
  const fromEntries = [...new Set(entries.map((e) => e.date))]
  const days = [...new Set([...fromEntries, ...extraDays])]
  if (extraDays.length) days.sort() // extra days are only passed for ascending views
  if (!days.length) return <p className="py-4 text-[13px] text-muted">{empty}</p>
  return (
    <ol className="space-y-4">
      {days.map((d) => {
        const hols = off?.get(d) ?? []
        const items = entries.filter((e) => e.date === d)
        return (
          <li key={d}>
            <h4 className="t-overline mb-1.5">{d === today() ? 'Today' : d === addDays(today(), 1) ? 'Tomorrow' : dayLabel(d)}</h4>
            {hols.length > 0 && (
              <ul className={`flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted ${items.length ? 'mb-1.5' : ''}`}>
                {hols.map((h) => (
                  <li key={h.name} className="flex min-w-0 items-center gap-1.5">
                    <Badge>{h.kind === 'personal' ? 'Day off' : h.kind === 'observance' ? 'Observance' : 'Holiday'}</Badge>
                    <span className="truncate">{h.name}</span>
                  </li>
                ))}
              </ul>
            )}
            {items.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {items.map((e) => {
                  const clash = off && offReason(e.date, off)
                  const nonWorking = e.kind === 'followup' && !e.done && off && (clash || isWeekend(e.date))
                  return (
                    <li key={e.uid} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={KIND_TONE[e.kind]} dot>
                            {KIND_LABEL[e.kind]}
                          </Badge>
                          {e.time && <span className="t-num text-[13px] text-muted">{e.time}</span>}
                          {e.done && <Badge>Done</Badge>}
                          {clash && e.kind !== 'followup' && <Badge tone="warning">On {clash}</Badge>}
                        </div>
                        <a
                          href={`#application?id=${encodeURIComponent(e.appId)}`}
                          className={`mt-1 block text-[13px] font-medium text-ink hover:underline ${e.done ? 'text-muted line-through' : ''}`}
                        >
                          {e.title}
                        </a>
                        {e.notes && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{e.notes}</p>}
                        {nonWorking && (
                          <p className="mt-1 text-xs text-warning">
                            Falls on {clash || 'a weekend'}.{' '}
                            {actions && onMove && (
                              <button type="button" className="font-medium underline hover:no-underline" onClick={() => onMove(e, nextWorkingDay(e.date, off))}>
                                Move to {dayLabel(nextWorkingDay(e.date, off))}
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                      {actions && (
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          {e.kind === 'followup' && onToggleDone && (
                            <Button size="sm" variant="ghost" onClick={() => onToggleDone(e)}>
                              {e.done ? 'Mark not done' : 'Mark done'}
                            </Button>
                          )}
                          {e.kind !== 'deadline' && onEdit && <IconButton icon={Pencil} label="Edit entry" size="sm" onClick={() => onEdit(e)} />}
                          <IconButton icon={Download} label="Add to calendar (.ics file)" size="sm" onClick={() => downloadIcs([e], fileName(e))} />
                          <a
                            href={googleCalendarUrl(e)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open in Google Calendar (new tab)"
                            title="Open in Google Calendar"
                            className="inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                          >
                            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
                          </a>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function EntryForm({ apps, draft, off, onClose }: { apps: Application[]; draft: Draft; off: OffMap; onClose: () => void }) {
  const [, setApps] = useApplications()
  const [d, setD] = useState(draft)
  const set = (p: Partial<Draft>) => setD((v) => ({ ...v, ...p }))
  const valid = !!d.appId && !!d.date
  const clash = d.date ? offReason(d.date, off) : undefined
  const better = d.date && d.kind === 'followup' && (clash || isWeekend(d.date)) ? nextWorkingDay(d.date, off) : ''
  const save = () => {
    if (!valid) return
    setApps((prev) => saveEntry(prev, d))
    toast(d.itemId ? 'Entry updated.' : 'Entry added.')
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={d.itemId ? 'Edit entry' : 'Add entry'}
      description="Entries are saved on the application and appear here and on the dashboard."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Application">
          <select className={inputCls} value={d.appId} onChange={(e) => set({ appId: e.target.value })} disabled={!!d.itemId} data-autofocus>
            <option value="">Choose an application</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {[a.role, a.company].filter(Boolean).join(' at ') || 'Untitled'}
              </option>
            ))}
          </select>
        </Field>
        {!d.itemId && (
          <Field label="Type">
            <select
              className={inputCls}
              value={d.kind}
              onChange={(e) => {
                const kind = e.target.value as Draft['kind']
                set({ kind, ...(kind === 'followup' && d.date ? { date: nextWorkingDay(d.date, off) } : {}) })
              }}
            >
              <option value="interview">Interview</option>
              <option value="followup">Follow-up</option>
            </select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <input type="date" className={inputCls} value={d.date} onChange={(e) => set({ date: e.target.value })} required />
          </Field>
          {d.kind === 'interview' && (
            <>
              <Field label="Time" hint="Optional">
                <input type="time" className={inputCls} value={d.time} onChange={(e) => set({ time: e.target.value })} />
              </Field>
              <Field label="Minutes">
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  className={inputCls}
                  value={d.duration}
                  onChange={(e) => set({ duration: Math.max(5, Math.min(600, Number(e.target.value) || 60)) })}
                />
              </Field>
            </>
          )}
        </div>
        {better ? (
          <Note tone="warning">
            This date falls on {clash || 'a weekend'}.{' '}
            <button type="button" className="font-medium underline hover:no-underline" onClick={() => set({ date: better })}>
              Use {dayLabel(better)} instead
            </button>
          </Note>
        ) : (
          clash && <Note tone="warning">This date falls on {clash}. Check that the employer is working that day.</Note>
        )}
        {d.kind === 'interview' && (
          <Field label="Title">
            <input className={inputCls} value={d.title} maxLength={120} placeholder="Interview" onChange={(e) => set({ title: e.target.value })} />
          </Field>
        )}
        <Field label={d.kind === 'interview' ? 'Notes' : 'What to follow up on'}>
          <textarea className={textareaCls} value={d.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function DayOffForm({ draft, onClose }: { draft: DayOff; onClose: () => void }) {
  const [days, setDays] = useDaysOff()
  const [d, setD] = useState(draft)
  const set = (p: Partial<DayOff>) => setD((v) => ({ ...v, ...p }))
  const valid = !!d.date && (!d.end || d.end >= d.date)
  const exists = days.some((x) => x.id === draft.id)
  const save = () => {
    if (!valid) return
    const item = { ...d, label: d.label.trim(), end: d.end && d.end > d.date ? d.end : undefined }
    setDays((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? item : x)) : [...prev, item]).sort((a, b) => a.date.localeCompare(b.date)))
    toast('Day off saved.')
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={exists ? 'Edit day off' : 'Add day off'}
      description="Leave, local festivals or the end of your notice period. Saved in this browser only."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" onClick={save} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Type">
          <select className={inputCls} value={d.kind} onChange={(e) => set({ kind: e.target.value as DayOffKind })} data-autofocus>
            {(Object.keys(DAY_OFF_LABEL) as DayOffKind[]).map((k) => (
              <option key={k} value={k}>
                {DAY_OFF_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" hint="Optional">
          <input className={inputCls} value={d.label} maxLength={80} placeholder={DAY_OFF_LABEL[d.kind]} onChange={(e) => set({ label: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={d.kind === 'notice' ? 'Last working day' : 'From'}>
            <input type="date" className={inputCls} value={d.date} onChange={(e) => set({ date: e.target.value })} required />
          </Field>
          {d.kind !== 'notice' && (
            <Field label="Until" hint="Optional">
              <input type="date" className={inputCls} value={d.end ?? ''} min={d.date} onChange={(e) => set({ end: e.target.value || undefined })} />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  )
}

function HolidayPanel({ years }: { years: number[] }) {
  const [settings, setSettings] = useHolidaySettings()
  const [profile] = useProfile()
  const profileCountry = COUNTRIES.find(([c]) => c === countryFromLocation(profile?.location))?.[1] ?? 'India'
  const { items, error, loading } = useHolidays(years)
  const [daysOff, setDaysOff] = useDaysOff()
  const [imports, setImports] = useHolidayImports()
  const [draft, setDraft] = useState<DayOff | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const regions = useMemo(() => regionsOf([...items, ...imports.flatMap((i) => i.items)]), [items, imports])
  const set = (p: Partial<typeof settings>) => setSettings((s) => ({ ...s, ...p }))
  const toggles = [
    ['public', 'Public holidays'],
    ['observance', 'Observances'],
    ['regional', 'Regional holidays'],
  ] as const

  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const imp = await importHolidayFile(file)
      setImports((prev) => [...prev, imp])
      toast(`Imported ${imp.items.length} ${imp.items.length === 1 ? 'day' : 'days'} from ${imp.file}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The file could not be read.')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Card title="Holidays and days off" className="lg:col-span-12">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Country">
            <select className={inputCls} value={settings.country} onChange={(e) => set({ country: e.target.value, region: '' })}>
              <option value="">From my profile ({profileCountry})</option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink">
            <legend className="sr-only">Holiday types to show</legend>
            {toggles.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-brand-600" checked={settings[k]} onChange={(e) => set({ [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          {settings.regional && regions.length > 0 && (
            <Field label="State or region" hint="Regional holidays for one place only">
              <select className={inputCls} value={settings.region} onChange={(e) => set({ region: e.target.value })}>
                <option value="">All regions</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {loading && <p className="text-[13px] text-muted">Loading holidays...</p>}
          {error && !loading && <Note tone="warning">{error} You can still import a holiday calendar file (.ics).</Note>}
          <div>
            <input ref={fileRef} type="file" accept=".ics,text/calendar" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
              Import holiday file (.ics)
            </Button>
            {imports.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {imports.map((i) => (
                  <Badge key={i.id} onRemove={() => setImports((prev) => prev.filter((x) => x.id !== i.id))} removeLabel="Remove imported file">
                    {i.file}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-medium text-ink">My days off</h3>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDraft({ id: newId(), date: today(), kind: 'leave', label: '' })}>
              Add day off
            </Button>
          </div>
          {daysOff.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {daysOff.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 text-[13px]">
                    <span className="font-medium text-ink">{d.label || DAY_OFF_LABEL[d.kind]}</span>
                    <span className="ml-2 text-muted">
                      {dayLabel(d.date)}
                      {d.end ? ` to ${dayLabel(d.end)}` : ''}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton icon={Pencil} label="Edit day off" size="sm" onClick={() => setDraft(d)} />
                    <IconButton icon={Trash2} label="Delete day off" size="sm" onClick={() => setDaysOff((prev) => prev.filter((x) => x.id !== d.id))} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Add leave, local festivals or the end of your notice period. Interviews on these days are flagged.</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Holiday dates come from public calendars and can vary by region.</p>
      {draft && <DayOffForm draft={draft} onClose={() => setDraft(null)} />}
    </Card>
  )
}

export default function CalendarPage() {
  const [apps, setApps] = useApplications()
  const entries = useMemo(() => calendarEntries(apps), [apps])
  const now = today()
  const [month, setMonth] = useState(now.slice(0, 8) + '01')
  const [selected, setSelected] = useState('')
  const [past, setPast] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [settings, setSettings] = useHolidaySettings()
  const [, setHolidayImports] = useHolidayImports()
  const [importing, setImporting] = useState(false)
  const years = calendarYears(month)
  const { off } = useOffDays(years)

  const blank = (): Draft => ({ appId: '', kind: 'interview', itemId: '', date: selected || now, time: '', duration: 60, title: '', notes: '' })
  const edit = (e: CalEntry) => {
    const a = apps.find((x) => x.id === e.appId)
    const i = a?.interviews?.find((x) => x.id === e.itemId)
    setDraft({ appId: e.appId, kind: e.kind === 'interview' ? 'interview' : 'followup', itemId: e.itemId, date: e.date, time: e.time, duration: e.duration_min || 60, title: i?.title ?? '', notes: e.notes })
  }
  const updateFollowup = (e: CalEntry, patch: (f: { done: boolean; date: string }) => object) =>
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== e.appId) return a
        const x = a
        return { ...x, followups: (x.followups ?? []).map((f) => (f.id === e.itemId ? { ...f, ...patch(f) } : f)) } as Application
      }),
    )
  const toggleDone = (e: CalEntry) => updateFollowup(e, (f) => ({ done: !f.done }))
  const move = (e: CalEntry, date: string) => {
    updateFollowup(e, () => ({ date }))
    toast(`Follow-up moved to ${dayLabel(date)}.`)
  }

  const shown = selected ? entries.filter((e) => e.date === selected) : entries.filter((e) => (past ? e.date < now : e.date >= now))
  const horizon = addDays(now, 30)
  const extraDays = selected ? (off.has(selected) ? [selected] : []) : past ? [] : [...off.keys()].filter((d) => d >= now && d <= horizon)

  const holidayEvents = (): AllDayEvent[] =>
    [...off.entries()].flatMap(([date, list]) => list.map((h) => ({ date, title: h.name, notes: h.kind === 'personal' ? 'Day off' : h.kind === 'observance' ? 'Observance' : 'Holiday' })))
  const exportAll = () => downloadIcs(entries, 'jivika-calendar.ics', settings.includeInExport ? holidayEvents() : [])

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Interviews, follow-ups and apply-by dates from your applications, with holidays and your days off."
        actions={
          <>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={settings.includeInExport}
                onChange={(e) => setSettings((s) => ({ ...s, includeInExport: e.target.checked }))}
              />
              Include holidays
            </label>
            <Button variant="secondary" icon={Download} disabled={!entries.length && !(settings.includeInExport && off.size)} onClick={exportAll}>
              Export all
            </Button>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button variant="brand" icon={Plus} disabled={!apps.length} onClick={() => setDraft(blank())}>
              Add entry
            </Button>
          </>
        }
      />
      <Note icon={CalendarDays}>
        Calendar files and Google Calendar links are made in your browser. Jivika does not connect to your calendar or send your entries anywhere.
      </Note>
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <MonthGrid entries={entries} month={month} onMonth={setMonth} selected={selected} onSelect={(d) => setSelected(d === selected ? '' : d)} off={off} />
        </Card>
        <Card
          className="lg:col-span-5"
          title={selected ? dayLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' }) : past ? 'Earlier' : 'Coming up'}
          action={
            selected ? (
              <Button size="sm" variant="ghost" onClick={() => setSelected('')}>
                Show all
              </Button>
            ) : (
              apps.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setPast(!past)}>
                  {past ? 'Show upcoming' : 'Show earlier'}
                </Button>
              )
            )
          }
        >
          {!apps.length && !selected ? (
            <>
              <EmptyState
                icon={<CalendarPlus />}
                title="Nothing to schedule yet"
                text="Start an application, then add interviews and follow-ups to see them here."
                action={
                  <ButtonLink href="#new-application" variant="brand" size="sm" icon={Plus}>
                    New application
                  </ButtonLink>
                }
              />
              <Agenda entries={[]} empty="" off={off} extraDays={extraDays} />
            </>
          ) : (
            <Agenda
              entries={past && !selected ? [...shown].reverse() : shown}
              empty={selected ? 'Nothing on this day.' : past ? 'No earlier entries.' : 'Nothing coming up. Add an interview or a follow-up to plan ahead.'}
              actions
              onEdit={edit}
              onToggleDone={toggleDone}
              onMove={move}
              off={off}
              extraDays={extraDays}
            />
          )}
        </Card>
        <HolidayPanel years={years} />
      </div>
      {draft && <EntryForm apps={apps} draft={draft} off={off} onClose={() => setDraft(null)} />}
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        unlinkedLabel="Add the rest as holidays"
        onUnlinkedEvents={(evs) =>
          setHolidayImports((prev) => [...prev, { id: newId(), file: 'Imported calendar', items: evs.map((e) => ({ date: e.date, name: e.title.slice(0, 200) || 'Holiday', kind: 'public' as const })) }])
        }
      />
    </>
  )
}
