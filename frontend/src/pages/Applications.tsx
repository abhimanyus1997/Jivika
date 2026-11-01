import { ExternalLink, KanbanSquare, Pencil, Plus, Search, SearchX, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatDate, safeLink } from '../components/ApplicationDetail'
import { ExportMenu } from '../components/ExportMenu'
import { ImportDialog } from '../components/ImportDialog'
import { matchLabel } from '../components/RequirementMatch'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  IconButton,
  inputCls,
  Modal,
  PageHeader,
  Segmented,
  StatusBadge,
  textareaCls,
  toast,
} from '../components/ui'
import {
  isTerminal,
  migrateApplication,
  newId,
  placeParts,
  read,
  STATUS_GROUPS,
  STATUSES,
  today,
  useApplications,
  useStored,
  withStatus,
  write,
  type Application,
  type Status,
  type WorkMode,
} from '../lib/store'
import { WORK_MODES } from './NewApplication'

type Filter = 'all' | 'open' | 'closed'
type Column = Status | 'Closed'

const OPEN = STATUS_GROUPS[0].statuses
const CLOSED = STATUS_GROUPS[1].statuses
const COLUMNS: Column[] = [...OPEN, 'Closed']

const blank = (): Application => ({ id: '', company: '', role: '', date: today(), status: 'Applied', link: '', notes: '' })

const openApp = (id: string) => (location.hash = `application?id=${id}`)

/** Days from today to an yyyy-mm-dd date (negative when past). */
function daysUntil(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return NaN
  const now = new Date()
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000)
}

/** 'today', 'yesterday', '3 days ago', or the date. */
export function relativeDay(iso: string) {
  const n = -daysUntil(iso)
  if (Number.isNaN(n)) return iso
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 30) return `${n} days ago`
  return formatDate(iso, { day: 'numeric', month: 'short' })
}

const updatedOn = (a: Application) => a.history?.at(-1)?.date ?? a.date

/** Amber within 7 days, red once passed on a draft. On the board it hides when it no longer matters; the table always shows it. */
function DeadlineBadge({ a, always = false }: { a: Application; always?: boolean }) {
  if (!a.deadline) return null
  const days = daysUntil(a.deadline)
  const relevant = !isTerminal(a.status) && !Number.isNaN(days) && (days >= 0 || a.status === 'Draft')
  if (!relevant && !always) return null
  const label = `Apply by ${formatDate(a.deadline, { day: 'numeric', month: 'short' })}`
  return (
    <Badge tone={!relevant ? 'neutral' : days < 0 ? 'danger' : days <= 7 ? 'warning' : 'neutral'} mono>
      {label}
      {relevant && days < 0 && <span className="sr-only"> (passed)</span>}
    </Badge>
  )
}

function MatchBadge({ a }: { a: Application }) {
  if (a.requirements?.summary.total)
    return (
      <Badge tone="brand" mono>
        {matchLabel(a.requirements.summary)}
        <span className="sr-only"> requirements met</span>
      </Badge>
    )
  if (typeof a.match === 'number')
    return (
      <Badge tone="brand" mono>
        {a.match}%<span className="sr-only"> match</span>
      </Badge>
    )
  return null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** '9 applications: 3 waiting to hear back, 2 in conversation.' */
export function applicationsSummary(apps: Application[]) {
  const count = (pred: (a: Application) => boolean) => apps.filter(pred).length
  const parts = [
    [count((a) => a.status === 'Draft'), (n: number) => plural(n, 'draft')],
    [count((a) => a.status === 'Applied'), (n: number) => `${n} waiting to hear back`],
    [count((a) => a.status === 'Screening' || a.status === 'Interview'), (n: number) => `${n} in conversation`],
    [count((a) => a.status === 'Offer'), (n: number) => `${n} with an offer`],
    [count((a) => isTerminal(a.status)), (n: number) => `${n} closed`],
  ] as const
  const text = parts.filter(([n]) => n > 0).map(([n, f]) => f(n))
  return `${plural(apps.length, 'application')}${text.length ? `: ${text.join(', ')}` : ''}.`
}

/** Kanban board: open statuses plus one Closed column. Cards drag between columns; the select on each card is the keyboard alternative. */
function Board({ apps, columns, onStatus }: { apps: Application[]; columns: Column[]; onStatus: (id: string, s: Column) => void }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Column | null>(null)
  return (
    <div className="relative grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2" aria-label="Applications board">
      {columns.map((col) => {
        const cards = apps.filter((a) => (col === 'Closed' ? isTerminal(a.status) : a.status === col))
        return (
          <section
            key={col}
            aria-label={`${col}, ${plural(cards.length, 'application')}`}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(col)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = dragId ?? e.dataTransfer.getData('text/plain')
              if (id) onStatus(id, col)
              setDragId(null)
              setOver(null)
            }}
            className={`flex min-h-48 flex-col rounded-xl border bg-subtle/60 transition-colors duration-150 ${over === col ? 'border-brand-500 bg-brand-50/60' : 'border-line'}`}
          >
            <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
              {col === 'Closed' ? <Badge>Closed</Badge> : <StatusBadge status={col} />}
              <span className="t-num text-xs text-faint">{cards.length}</span>
            </header>
            <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {cards.map((a) => (
                <li
                  key={a.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(a.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', a.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOver(null)
                  }}
                  className={`cursor-grab rounded-lg border border-line bg-surface p-3 shadow-card active:cursor-grabbing ${dragId === a.id ? 'opacity-50' : ''}`}
                >
                  <a href={`#application?id=${a.id}`} className="block min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink hover:text-brand-700">{a.company || 'Company'}</span>
                    <span className="block truncate text-[13px] text-muted">{a.role || 'Role'}</span>
                    {(a.location || a.work_mode) && (
                      <span className="block truncate text-xs text-faint">{placeParts(a.location, a.work_mode).join(' · ')}</span>
                    )}
                  </a>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {col === 'Closed' && <StatusBadge status={a.status} />}
                    <DeadlineBadge a={a} />
                    <MatchBadge a={a} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-faint">Updated {relativeDay(updatedOn(a))}</span>
                  </div>
                  <label className="mt-2 block">
                    <span className="sr-only">
                      Move {a.company} {a.role} to status
                    </span>
                    <select className={`${inputCls} h-7 text-xs`} value={a.status} onChange={(e) => onStatus(a.id, e.target.value as Status)}>
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
              {!cards.length && <li className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-faint">Drop an application here</li>}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export default function Applications() {
  const [apps, setApps] = useApplications()
  const [draft, setDraft] = useState<Application | null>(null)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null)
  const [closing, setClosing] = useState<Application | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useStored<'board' | 'table'>('applicationsView', 'board')
  const [announce, setAnnounce] = useState('')

  // The command palette links to #applications?new to open the add dialog.
  useEffect(() => {
    const check = () => {
      if (location.hash.endsWith('?new')) {
        // Job search leaves a prefilled draft here before linking to #applications?new.
        setDraft({ ...blank(), ...read<Partial<Application>>('applicationDraft', {}) })
        write('applicationDraft', null)
        history.replaceState(null, '', '#applications')
      }
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  function save() {
    if (!draft) return
    const entry = { ...draft, company: draft.company.trim(), role: draft.role.trim(), link: draft.link.trim() }
    if (entry.id) {
      // Keep the timeline: a status change in the form is recorded like any other.
      setApps((list) => list.map((a) => (a.id === entry.id ? withStatus({ ...entry, status: a.status, history: migrateApplication(a).history }, entry.status) : a)))
    } else {
      setApps((list) => [migrateApplication({ ...entry, id: newId(), created: entry.created ?? today() }), ...list])
    }
    toast(entry.id ? 'Application updated' : 'Application added')
    setDraft(null)
  }

  function setStatus(id: string, status: Column) {
    const a = apps.find((x) => x.id === id)
    if (!a || a.status === status) return
    // Dropping on Closed asks how it ended; an already closed card stays as it is.
    if (status === 'Closed') {
      if (!isTerminal(a.status)) setClosing(a)
      return
    }
    setApps((list) => list.map((x) => (x.id === id ? withStatus(x, status) : x)))
    setAnnounce(`${a.company} moved to ${status}.`)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setApps((list) => list.filter((a) => a.id !== id))
    setPendingDelete(null)
    toast('Application deleted')
  }

  const set = <K extends keyof Application>(k: K, v: Application[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const q = query.trim().toLowerCase()
  const searched = [...apps]
    .sort((a, b) => updatedOn(b).localeCompare(updatedOn(a)))
    .filter((a) => !q || `${a.company} ${a.role}`.toLowerCase().includes(q))
  const inFilter = (a: Application) => filter === 'all' || (filter === 'closed') === isTerminal(a.status)
  const visible = searched.filter(inFilter)
  const columns = filter === 'all' ? COLUMNS : filter === 'open' ? OPEN : (['Closed'] as Column[])

  const filterOptions = [
    { value: 'all' as Filter, label: 'All', count: apps.length },
    { value: 'open' as Filter, label: STATUS_GROUPS[0].label, count: apps.filter((a) => !isTerminal(a.status)).length },
    { value: 'closed' as Filter, label: STATUS_GROUPS[1].label, count: apps.filter((a) => isTerminal(a.status)).length },
  ]

  return (
    <>
      <PageHeader
        title="Applications"
        description={apps.length ? applicationsSummary(apps) : 'Track where you have applied. Status updates feed the trends on your dashboard.'}
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
              Import
            </Button>
            <ExportMenu formats={['applications-csv', 'applications-json', 'calendar-ics']} />
            <Button variant="secondary" icon={Plus} onClick={() => setDraft(blank())}>
              Log an application
            </Button>
            <ButtonLink href="#new-application" variant="brand" icon={Plus}>
              New application
            </ButtonLink>
          </>
        }
      />

      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      {apps.length ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Segmented
              label="View"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'table', label: 'Table' },
              ]}
            />
            <Segmented label="Show" size="sm" options={filterOptions} value={filter} onChange={setFilter} />
            <div className="relative lg:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" strokeWidth={1.75} aria-hidden="true" />
              <input
                type="search"
                className={`${inputCls} pl-8`}
                placeholder="Search company or role"
                aria-label="Search applications"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {view === 'board' ? (
            <>
              <p className="text-xs text-faint">Drag a card to another column, or change its status with the menu on the card. Select a card to open it.</p>
              <Board apps={visible} columns={columns} onStatus={setStatus} />
            </>
          ) : visible.length ? (
            <div className="table-wrap">
              <table className="data-table min-w-[560px] md:min-w-[960px]">
                <caption className="sr-only">Tracked applications</caption>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th className="hidden md:table-cell">Location</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Apply by</th>
                    <th className="hidden md:table-cell">Match</th>
                    <th>Updated</th>
                    <th className="hidden md:table-cell">Link</th>
                    <th className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">
                        <button type="button" className="text-left hover:text-brand-700 hover:underline" onClick={() => openApp(a.id)}>
                          {a.company}
                        </button>
                      </td>
                      <td className="text-muted">{a.role}</td>
                      <td className="hidden text-[13px] text-muted md:table-cell">{placeParts(a.location, a.work_mode).join(' · ') || '-'}</td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="hidden md:table-cell">{a.deadline ? <DeadlineBadge a={a} always /> : <span className="text-faint">-</span>}</td>
                      <td className="hidden md:table-cell">
                        <MatchBadge a={a} />
                      </td>
                      <td className="text-[13px] whitespace-nowrap text-muted">{relativeDay(updatedOn(a))}</td>
                      <td className="hidden md:table-cell">
                        {a.link ? (
                          <a
                            href={safeLink(a.link)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            Open <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                            <span className="sr-only">job posting for {a.company}</span>
                          </a>
                        ) : (
                          <span className="text-faint">-</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <IconButton icon={Pencil} size="sm" label={`Edit ${a.company} application`} onClick={() => setDraft(a)} />
                        <IconButton
                          icon={Trash2}
                          size="sm"
                          label={`Delete ${a.company} application`}
                          className="hover:bg-danger-bg hover:text-danger"
                          onClick={() => setPendingDelete(a)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={<SearchX />}
                title="No matching applications"
                text="Try a different search or filter."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('')
                      setFilter('all')
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            </Card>
          )}
          <span className="sr-only" aria-live="polite">
            {announce}
          </span>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<KanbanSquare />}
            title="No applications yet"
            text="Start one from a job posting, or log a job you already applied to."
            action={
              <ButtonLink href="#new-application" variant="brand" icon={Plus}>
                New application
              </ButtonLink>
            }
          />
        </Card>
      )}

      <Modal
        open={!!closing}
        onClose={() => setClosing(null)}
        title="How did it end?"
        description={closing ? `${closing.role || 'Role'} at ${closing.company || 'company'}` : undefined}
        width="max-w-md"
      >
        <div className="grid grid-cols-2 gap-2">
          {CLOSED.map((s) => (
            <Button
              key={s}
              variant="secondary"
              onClick={() => {
                if (closing) {
                  setApps((list) => list.map((x) => (x.id === closing.id ? withStatus(x, s) : x)))
                  setAnnounce(`${closing.company} moved to ${s}.`)
                }
                setClosing(null)
              }}
            >
              {s}
            </Button>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit application' : 'Log an application'}
        description="Saved in this browser only."
        footer={
          <>
            {draft?.id && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="mr-auto hover:text-danger"
                onClick={() => {
                  setPendingDelete(draft)
                  setDraft(null)
                }}
              >
                Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" form="application-form">
              {draft?.id ? 'Save changes' : 'Add application'}
            </Button>
          </>
        }
      >
        {draft && (
          <form
            id="application-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company">
                <input required data-autofocus className={inputCls} value={draft.company} onChange={(e) => set('company', e.target.value)} />
              </Field>
              <Field label="Role">
                <input required className={inputCls} value={draft.role} onChange={(e) => set('role', e.target.value)} />
              </Field>
              <Field label="Date">
                <input required type="date" className={`${inputCls} t-num`} value={draft.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={draft.status} onChange={(e) => set('status', e.target.value as Status)}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Location">
                <input className={inputCls} value={draft.location ?? ''} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="Work mode">
                <select className={inputCls} value={draft.work_mode ?? ''} onChange={(e) => set('work_mode', e.target.value as WorkMode)}>
                  <option value="">Not stated</option>
                  {WORK_MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Salary">
                <input className={inputCls} value={draft.salary ?? ''} onChange={(e) => set('salary', e.target.value)} />
              </Field>
              <Field label="Apply by">
                <input type="date" className={`${inputCls} t-num`} value={draft.deadline ?? ''} onChange={(e) => set('deadline', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Job link">
                  <input type="url" className={inputCls} value={draft.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
                </Field>
              </div>
            </div>
            <Field label="Notes">
              <textarea className={`${textareaCls} h-24`} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete application"
        width="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Delete the application for {pendingDelete?.role || 'this role'} at {pendingDelete?.company || 'this company'}? This cannot be undone.
        </p>
      </Modal>
    </>
  )
}
