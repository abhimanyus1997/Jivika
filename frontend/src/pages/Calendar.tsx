import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, ExternalLink, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, ButtonLink, Card, EmptyState, Field, IconButton, Modal, Note, PageHeader, inputCls, textareaCls, toast } from '../components/ui'
import { KIND_LABEL, addDays, calendarEntries, dayLabel, downloadIcs, googleCalendarUrl, iso, parseDay as parse, type CalEntry, type EntryDraft as Draft, type EntryKind, saveEntry } from '../lib/ics'
import { today, useApplications, type Application } from '../lib/store'

const KIND_DOT: Record<EntryKind, string> = { interview: 'bg-accent-500', followup: 'bg-info', deadline: 'bg-danger' }
const KIND_TONE = { interview: 'accent', followup: 'info', deadline: 'danger' } as const

const fileName = (e: CalEntry) => `${(e.company || 'jivika').replace(/[^\w-]+/g, '-').toLowerCase()}-${e.kind}-${e.date}.ics`

/** Month grid with a dot per entry kind. Days are buttons when onSelect is given. */
export function MonthGrid({
  entries,
  month,
  onMonth,
  selected,
  onSelect,
  compact = false,
}: {
  entries: CalEntry[]
  month: string // yyyy-mm-01
  onMonth: (m: string) => void
  selected?: string
  onSelect?: (day: string) => void
  compact?: boolean
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
          const kinds = [...new Set(list.map((e) => e.kind))]
          const inMonth = d.slice(0, 7) === month.slice(0, 7)
          const isToday = d === now
          const cls = `relative flex flex-col items-center justify-start rounded-md ${compact ? 'h-9 pt-1' : 'h-16 pt-1.5'} text-[13px] ${
            inMonth ? 'text-ink' : 'text-faint'
          } ${selected === d ? 'bg-brand-50 ring-1 ring-brand-200' : onSelect ? 'hover:bg-subtle' : ''}`
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
            </>
          )
          const label = `${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${list.length} ${list.length === 1 ? 'entry' : 'entries'}` : ''}`
          return onSelect ? (
            <button key={d} type="button" className={cls} aria-label={label} aria-pressed={selected === d} onClick={() => onSelect(d)}>
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
      </ul>
    </div>
  )
}

/** Entries grouped by day. Actions are optional so the dashboard can show a compact list. */
export function Agenda({
  entries,
  empty,
  actions = false,
  onEdit,
  onToggleDone,
}: {
  entries: CalEntry[]
  empty: string
  actions?: boolean
  onEdit?: (e: CalEntry) => void
  onToggleDone?: (e: CalEntry) => void
}) {
  if (!entries.length) return <p className="py-4 text-[13px] text-muted">{empty}</p>
  const days = [...new Set(entries.map((e) => e.date))]
  return (
    <ol className="space-y-4">
      {days.map((d) => (
        <li key={d}>
          <h4 className="t-overline mb-1.5">{d === today() ? 'Today' : d === addDays(today(), 1) ? 'Tomorrow' : dayLabel(d)}</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {entries
              .filter((e) => e.date === d)
              .map((e) => (
                <li key={e.uid} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[e.kind]} dot>
                        {KIND_LABEL[e.kind]}
                      </Badge>
                      {e.time && <span className="t-num text-[13px] text-muted">{e.time}</span>}
                      {e.done && <Badge>Done</Badge>}
                    </div>
                    <a
                      href={`#application?id=${encodeURIComponent(e.appId)}`}
                      className={`mt-1 block text-[13px] font-medium text-ink hover:underline ${e.done ? 'text-muted line-through' : ''}`}
                    >
                      {e.title}
                    </a>
                    {e.notes && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{e.notes}</p>}
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
              ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

function EntryForm({ apps, draft, onClose }: { apps: Application[]; draft: Draft; onClose: () => void }) {
  const [, setApps] = useApplications()
  const [d, setD] = useState(draft)
  const set = (p: Partial<Draft>) => setD((v) => ({ ...v, ...p }))
  const valid = !!d.appId && !!d.date
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
            <select className={inputCls} value={d.kind} onChange={(e) => set({ kind: e.target.value as Draft['kind'] })}>
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

export default function CalendarPage() {
  const [apps, setApps] = useApplications()
  const entries = useMemo(() => calendarEntries(apps), [apps])
  const now = today()
  const [month, setMonth] = useState(now.slice(0, 8) + '01')
  const [selected, setSelected] = useState('')
  const [past, setPast] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  const blank = (): Draft => ({ appId: '', kind: 'interview', itemId: '', date: selected || now, time: '', duration: 60, title: '', notes: '' })
  const edit = (e: CalEntry) => {
    const a = apps.find((x) => x.id === e.appId)
    const i = a?.interviews?.find((x) => x.id === e.itemId)
    setDraft({ appId: e.appId, kind: e.kind === 'interview' ? 'interview' : 'followup', itemId: e.itemId, date: e.date, time: e.time, duration: e.duration_min || 60, title: i?.title ?? '', notes: e.notes })
  }
  const toggleDone = (e: CalEntry) =>
    setApps((prev) =>
      prev.map((a) => {
        if (a.id !== e.appId) return a
        const x = a
        return { ...x, followups: (x.followups ?? []).map((f) => (f.id === e.itemId ? { ...f, done: !f.done } : f)) } as Application
      }),
    )

  const shown = selected ? entries.filter((e) => e.date === selected) : entries.filter((e) => (past ? e.date < now : e.date >= now))

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Interviews, follow-ups and apply-by dates from your applications."
        actions={
          <>
            <Button variant="secondary" icon={Download} disabled={!entries.length} onClick={() => downloadIcs(entries, 'jivika-calendar.ics')}>
              Export all
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
      {!apps.length ? (
        <Card>
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
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <MonthGrid entries={entries} month={month} onMonth={setMonth} selected={selected} onSelect={(d) => setSelected(d === selected ? '' : d)} />
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
                <Button size="sm" variant="ghost" onClick={() => setPast(!past)}>
                  {past ? 'Show upcoming' : 'Show earlier'}
                </Button>
              )
            }
          >
            <Agenda
              entries={past && !selected ? [...shown].reverse() : shown}
              empty={selected ? 'Nothing on this day.' : past ? 'No earlier entries.' : 'Nothing coming up. Add an interview or a follow-up to plan ahead.'}
              actions
              onEdit={edit}
              onToggleDone={toggleDone}
            />
          </Card>
        </div>
      )}
      {draft && <EntryForm apps={apps} draft={draft} onClose={() => setDraft(null)} />}
    </>
  )
}
