import { ExternalLink, KanbanSquare, Pencil, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
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
import { newId, read, STATUSES, today, useApplications, write, type Application, type Status } from '../lib/store'

type Filter = 'all' | Status

const blank = (): Application => ({ id: '', company: '', role: '', date: today(), status: 'Applied', link: '', notes: '' })

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const safeLink = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

export default function Applications() {
  const [apps, setApps] = useApplications()
  const [draft, setDraft] = useState<Application | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

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
    setApps((list) => (entry.id ? list.map((a) => (a.id === entry.id ? entry : a)) : [{ ...entry, id: newId() }, ...list]))
    toast(entry.id ? 'Application updated' : 'Application added')
    setDraft(null)
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
  const visible = [...apps]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((a) => filter === 'all' || a.status === filter)
    .filter((a) => !q || `${a.company} ${a.role} ${a.notes}`.toLowerCase().includes(q))

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
            <Segmented label="Filter by status" size="sm" options={filterOptions} value={filter} onChange={setFilter} />
          </div>

          {visible.length ? (
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
                      <td className="font-medium">{a.company}</td>
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

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit application' : 'Add application'}
        description="Saved in this browser only."
        footer={
          <>
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
