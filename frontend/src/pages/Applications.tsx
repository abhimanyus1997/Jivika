import { ExternalLink, KanbanSquare, Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApplicationDetail, formatDate, safeLink } from '../components/ApplicationDetail'
import {
  Badge,
  Button,
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
  migrateApplication,
  newId,
  read,
  STATUSES,
  today,
  useApplications,
  useStored,
  withStatus,
  write,
  type Application,
  type Status,
} from '../lib/store'

type Filter = 'all' | Status

const blank = (): Application => ({ id: '', company: '', role: '', date: today(), status: 'Applied', link: '', notes: '' })

/** Kanban board: one column per status. Cards drag between columns; the status select on each card is the keyboard alternative. */
function Board({ apps, onStatus, onOpen }: { apps: Application[]; onStatus: (id: string, s: Status) => void; onOpen: (id: string) => void }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
  return (
    <div className="relative grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2" aria-label="Applications board">
      {STATUSES.map((status) => {
        const cards = apps.filter((a) => a.status === status)
        return (
          <section
            key={status}
            aria-label={`${status}, ${cards.length} ${cards.length === 1 ? 'application' : 'applications'}`}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(status)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = dragId ?? e.dataTransfer.getData('text/plain')
              if (id) onStatus(id, status)
              setDragId(null)
              setOver(null)
            }}
            className={`flex min-h-48 flex-col rounded-xl border bg-subtle/60 transition-colors duration-150 ${over === status ? 'border-brand-500 bg-brand-50/60' : 'border-line'}`}
          >
            <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
              <StatusBadge status={status} />
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
                  <button type="button" onClick={() => onOpen(a.id)} className="block w-full min-w-0 text-left">
                    <span className="block truncate text-[13px] font-semibold text-ink hover:text-brand-700">{a.company || 'Company'}</span>
                    <span className="block truncate text-[13px] text-muted">{a.role || 'Role'}</span>
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="t-num text-xs text-faint">{formatDate(a.date)}</span>
                    {typeof a.match === 'number' && (
                      <Badge tone="brand" mono>
                        {a.match}%<span className="sr-only"> match</span>
                      </Badge>
                    )}
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
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
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
      setApps((list) => [migrateApplication({ ...entry, id: newId() }), ...list])
    }
    toast(entry.id ? 'Application updated' : 'Application added')
    setDraft(null)
  }

  function setStatus(id: string, status: Status) {
    const a = apps.find((x) => x.id === id)
    if (!a || a.status === status) return
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
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((a) => !q || `${a.company} ${a.role} ${a.notes}`.toLowerCase().includes(q))
  const visible = searched.filter((a) => filter === 'all' || a.status === filter)

  const filterOptions = [
    { value: 'all' as Filter, label: 'All', count: apps.length },
    ...STATUSES.map((s) => ({ value: s as Filter, label: s, count: apps.filter((a) => a.status === s).length })),
  ]

  return (
    <>
      <PageHeader
        title="Applications"
        description="Track where you have applied. Status updates feed the trends on your dashboard."
        actions={
          <Button icon={Plus} onClick={() => setDraft(blank())}>
            Add application
          </Button>
        }
      />

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
            <div className="relative lg:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" strokeWidth={1.75} aria-hidden="true" />
              <input
                type="search"
                className={`${inputCls} pl-8`}
                placeholder="Search company, role or notes"
                aria-label="Search applications"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {view === 'table' && <Segmented label="Filter by status" size="sm" options={filterOptions} value={filter} onChange={setFilter} />}
          </div>

          {view === 'board' ? (
            <>
              <p className="text-xs text-faint">Drag a card to another column, or change its status with the menu on the card. Select a card to see details.</p>
              <Board apps={searched} onStatus={setStatus} onOpen={setOpenId} />
            </>
          ) : visible.length ? (
            <div className="table-wrap">
              <table className="data-table min-w-[520px] md:min-w-[760px]">
                <caption className="sr-only">Tracked applications</caption>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Applied</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Link</th>
                    <th className="hidden md:table-cell">Notes</th>
                    <th className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">
                        <button type="button" className="text-left hover:text-brand-700 hover:underline" onClick={() => setOpenId(a.id)}>
                          {a.company}
                        </button>
                      </td>
                      <td className="text-muted">{a.role}</td>
                      <td className="t-num text-[13px] whitespace-nowrap text-muted">{formatDate(a.date)}</td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
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
                      <td className="hidden max-w-64 text-[13px] text-muted md:table-cell">
                        <span className="line-clamp-1" title={a.notes}>
                          {a.notes}
                        </span>
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
                text="Try a different search or status filter."
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
            text="Add the jobs you apply to, or use Track application from a job match."
            action={
              <Button icon={Plus} onClick={() => setDraft(blank())}>
                Add application
              </Button>
            }
          />
        </Card>
      )}

      <ApplicationDetail
        appId={openId}
        onClose={() => setOpenId(null)}
        onEdit={(a) => {
          setOpenId(null)
          setDraft(a)
        }}
      />

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit application' : 'Add application'}
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
              <Field label="Date applied">
                <input required type="date" className={`${inputCls} t-num`} value={draft.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={draft.status} onChange={(e) => set('status', e.target.value as Status)}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
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
