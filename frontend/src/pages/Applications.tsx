import { ExternalLink, KanbanSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Chip, EmptyState, Field, inputCls, PageIntro } from '../components/ui'
import { newId, STATUSES, today, useApplications, type Application, type Status } from '../lib/store'

const STATUS_TONE: Record<Status, 'slate' | 'indigo' | 'emerald' | 'rose' | 'amber'> = {
  Applied: 'slate',
  'Awaiting response': 'amber',
  'Response received': 'indigo',
  Interview: 'indigo',
  Offer: 'emerald',
  Rejected: 'rose',
}

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

  function save() {
    if (!draft) return
    const entry = { ...draft, company: draft.company.trim(), role: draft.role.trim(), link: draft.link.trim() }
    setApps((list) => (entry.id ? list.map((a) => (a.id === entry.id ? entry : a)) : [{ ...entry, id: newId() }, ...list]))
    setDraft(null)
  }

  function remove(app: Application) {
    if (confirm(`Delete the application for ${app.role || 'this role'} at ${app.company || 'this company'}?`)) {
      setApps((list) => list.filter((a) => a.id !== app.id))
    }
  }

  const set = <K extends keyof Application>(k: K, v: Application[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const sorted = [...apps].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageIntro>Keep track of where you have applied. Status updates feed the trends on your dashboard.</PageIntro>
        {!draft && apps.length > 0 && (
          <Button onClick={() => setDraft(blank())}>
            <Plus className="size-4" aria-hidden="true" />
            Add application
          </Button>
        )}
      </div>

      {draft && (
        <Card title={draft.id ? 'Edit application' : 'New application'}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Company">
                <input required autoFocus className={inputCls} value={draft.company} onChange={(e) => set('company', e.target.value)} />
              </Field>
              <Field label="Role">
                <input required className={inputCls} value={draft.role} onChange={(e) => set('role', e.target.value)} />
              </Field>
              <Field label="Date applied">
                <input required type="date" className={inputCls} value={draft.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={draft.status} onChange={(e) => set('status', e.target.value as Status)}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Job link">
                <input type="url" className={inputCls} value={draft.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={`${inputCls} h-20`} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">{draft.id ? 'Save changes' : 'Add application'}</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {sorted.length ? (
          <div className="relative -mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Tracked applications</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Company</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Date applied</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Link</th>
                  <th className="py-2 pr-4 font-medium">Notes</th>
                  <th className="py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-3 pr-4 font-medium text-slate-900">{a.company}</td>
                    <td className="py-3 pr-4 text-slate-700">{a.role}</td>
                    <td className="py-3 pr-4 tabular-nums text-slate-600">{formatDate(a.date)}</td>
                    <td className="py-3 pr-4">
                      <Chip tone={STATUS_TONE[a.status]}>{a.status}</Chip>
                    </td>
                    <td className="py-3 pr-4">
                      {a.link ? (
                        <a
                          href={safeLink(a.link)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
                        >
                          Open <ExternalLink className="size-3.5" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="max-w-56 py-3 pr-4 text-slate-600">
                      <span className="line-clamp-2">{a.notes}</span>
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setDraft(a)}
                        aria-label={`Edit ${a.company} application`}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a)}
                        aria-label={`Delete ${a.company} application`}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<KanbanSquare className="size-8" />}
            title="No applications yet"
            text="Add the jobs you apply to, or use Track application from a job match."
            action={!draft && <Button onClick={() => setDraft(blank())}>Add application</Button>}
          />
        )}
      </Card>
    </>
  )
}
