import { CalendarPlus, Inbox as InboxIcon, Link2, Mail, MailOpen, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { mailtoHref } from '../components/ApplicationDetail'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  KeyNotice,
  Note,
  PageHeader,
  Segmented,
  StatusBadge,
  inputCls,
  textareaCls,
  toast,
} from '../components/ui'
import { useAction, useAiReady, type EmailTone } from '../lib/api'
import { KIND_INFO, inboxApi, needsAnswer, senderAddress, useInbox, type InboxItem } from '../lib/inbox'
import { newId, normStatus, useApplications, useProfile, useStructuredProfile, withStatus, type Application, type Status } from '../lib/store'
import { saveEntry } from '../lib/ics'

const appLabel = (a: Application) => [a.role, a.company].filter(Boolean).join(' at ') || 'Untitled application'

/** Local date and time from an ISO string. A bare date keeps its day (no UTC shift). */
function splitIso(s: string): { date: string; time: string } | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: '' }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
const formatWhen = (s: string) => {
  const p = splitIso(s)
  if (!p) return s
  const [y, m, d] = p.date.split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return p.time ? `${day}, ${p.time}` : day
}

function ReplyPanel({ item, app, update }: { item: InboxItem; app?: Application; update: (p: Partial<InboxItem>) => void }) {
  const [sp] = useStructuredProfile()
  const [profile] = useProfile()
  const [tone, setTone] = useState<EmailTone>(item.reply?.tone ?? 'warm')
  const [availability, setAvailability] = useState(item.availability ?? '')
  const ready = useAiReady()
  const { run, loading, error } = useAction(inboxApi.reply)
  const b = sp?.basics
  const draft = async () => {
    const r = await run({
      email_text: item.email_text,
      kind: item.kind,
      basics: { name: b?.name || profile?.name || '', email: b?.email || '', phone: b?.phone || '' },
      application: { company: app?.company || item.sender_company, role: app?.role || '' },
      profile_summary: (b?.summary || profile?.headline || '').slice(0, 2000) || undefined,
      availability: availability.trim() || undefined,
      tone,
    })
    if (r) update({ reply: { ...r, tone }, availability })
  }
  const to = senderAddress(item.email_text, b?.email)
  const reply = item.reply
  const mailto = reply ? mailtoHref(to, reply.subject, reply.body) : ''

  return (
    <div className="space-y-3 rounded-lg border border-line bg-canvas p-3">
      <Field label="Your availability" hint="Optional. For example: weekdays after 2 pm, or Thursday morning.">
        <textarea className={`${textareaCls} min-h-16!`} maxLength={500} value={availability} onChange={(e) => setAvailability(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Reply tone"
          size="sm"
          value={tone}
          onChange={setTone}
          options={[
            { value: 'formal', label: 'Formal' },
            { value: 'warm', label: 'Warm' },
            { value: 'concise', label: 'Concise' },
          ]}
        />
        <Button size="sm" variant="brand" loading={loading} disabled={!ready} onClick={draft}>
          {reply ? 'Write again' : 'Write reply'}
        </Button>
      </div>
      <ErrorMessage message={error} />
      {reply && (
        <div className="space-y-2">
          <Field label="Subject">
            <input className={inputCls} value={reply.subject} onChange={(e) => update({ reply: { ...reply, subject: e.target.value } })} />
          </Field>
          <Field label="Message">
            <textarea className={`${textareaCls} min-h-48!`} value={reply.body} onChange={(e) => update({ reply: { ...reply, body: e.target.value } })} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={`Subject: ${reply.subject}\n\n${reply.body}`} label="Copy reply" />
            <ButtonLink href={mailto} size="sm" icon={MailOpen}>
              Open in mail app
            </ButtonLink>
            {!item.answered && (
              <Button size="sm" variant="ghost" onClick={() => update({ answered: true })}>
                Mark as answered
              </Button>
            )}
          </div>
          <p className="text-xs text-faint">The reply uses only your profile details and what you wrote above. Read it before you send it.</p>
        </div>
      )}
    </div>
  )
}

function InboxCard({ item, apps }: { item: InboxItem; apps: Application[] }) {
  const [, setItems] = useInbox()
  const [, setApps] = useApplications()
  const [pick, setPick] = useState(item.application_id)
  const [replying, setReplying] = useState(!!item.reply)
  const app = apps.find((a) => a.id === item.application_id)
  const update = (p: Partial<InboxItem>) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...p } : i)))
  const info = KIND_INFO[item.kind] ?? KIND_INFO.other
  const suggested = item.suggested_status
  const canUpdate = !!app && !!suggested && normStatus(app.status) !== suggested && !item.status_applied

  const addInterview = (iso: string) => {
    const p = splitIso(iso)
    if (!app || !p) return
    setApps((prev) =>
      saveEntry(prev, { appId: app.id, kind: 'interview', itemId: '', date: p.date, time: p.time, duration: 60, title: 'Interview',
        notes: `From an email${item.sender_name ? ` from ${item.sender_name}` : ''}.` }),
    )
    update({ added_times: [...(item.added_times ?? []), iso] })
    toast('Interview added to the calendar.')
  }

  return (
    <li className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={info.tone} dot>
              {info.label}
            </Badge>
            {needsAnswer(item) && <Badge tone="warning">Needs an answer</Badge>}
            {item.answered && <Badge>Answered</Badge>}
            <span className="text-xs text-faint">Added {new Date(item.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
          </div>
          <p className="mt-1.5 text-[13px] font-medium text-ink">{[item.sender_name, item.sender_company].filter(Boolean).join(' · ') || 'Sender not stated'}</p>
          <p className="mt-0.5 text-sm text-ink">{item.summary}</p>
        </div>
        <IconButton icon={Trash2} label="Delete this email" size="sm" onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 sm:max-w-sm">
          <span className="t-label mb-1.5 block">Application</span>
          <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Not linked</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {appLabel(a)}
              </option>
            ))}
          </select>
        </label>
        {pick !== item.application_id && (
          <Button size="sm" icon={Link2} onClick={() => update({ application_id: pick, status_applied: false })}>
            Link
          </Button>
        )}
        {app && pick === item.application_id && (
          <>
            <StatusBadge status={app.status} />
            <ButtonLink size="sm" variant="ghost" href={`#application?id=${encodeURIComponent(app.id)}`}>
              Open application
            </ButtonLink>
          </>
        )}
      </div>

      {(canUpdate || item.proposed_times.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {canUpdate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setApps((prev) => prev.map((a) => (a.id === app.id ? withStatus(a, suggested as Status) : a)))
                update({ status_applied: true })
                toast(`Status updated to ${suggested}.`)
              }}
            >
              Update status to {suggested}
            </Button>
          )}
          {item.proposed_times.map((t) => {
            const added = item.added_times?.includes(t)
            return (
              <Button
                key={t}
                size="sm"
                variant="ghost"
                icon={CalendarPlus}
                disabled={!app || added}
                title={!app ? 'Link an application first' : undefined}
                onClick={() => addInterview(t)}
              >
                {added ? `Added: ${formatWhen(t)}` : `Add interview: ${formatWhen(t)}`}
              </Button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!replying && (
          <Button size="sm" icon={Mail} onClick={() => setReplying(true)}>
            Draft reply
          </Button>
        )}
        {needsAnswer(item) && !replying && (
          <Button size="sm" variant="ghost" onClick={() => update({ answered: true })}>
            Mark as answered
          </Button>
        )}
        {item.answered && (
          <Button size="sm" variant="ghost" onClick={() => update({ answered: false })}>
            Mark as not answered
          </Button>
        )}
      </div>
      {replying && <ReplyPanel item={item} app={app} update={update} />}

      <details className="text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Show the email</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-subtle p-3 font-sans text-[13px] whitespace-pre-wrap text-ink">{item.email_text}</pre>
      </details>
    </li>
  )
}

function Section({ title, description, items, apps }: { title: string; description: string; items: InboxItem[]; apps: Application[] }) {
  if (!items.length) return null
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="t-title">
          {title} <span className="t-num text-muted">{items.length}</span>
        </h2>
        <p className="text-[13px] text-muted">{description}</p>
      </div>
      <ul className="space-y-3">
        {items.map((i) => (
          <InboxCard key={i.id} item={i} apps={apps} />
        ))}
      </ul>
    </section>
  )
}

export default function InboxPage() {
  const [items, setItems] = useInbox()
  const [apps] = useApplications()
  const [text, setText] = useState('')
  const ready = useAiReady()
  const { run, loading, error } = useAction(inboxApi.classify)

  const read = async () => {
    const r = await run(text.trim(), apps.map((a) => ({ id: a.id, company: a.company, role: a.role, status: String(a.status) })))
    if (!r) return
    const valid = apps.some((a) => a.id === r.application_id) ? r.application_id : ''
    const item: InboxItem = { ...r, application_id: valid, proposed_times: r.proposed_times ?? [], id: newId(), added: new Date().toISOString(), email_text: text.trim() }
    setItems((prev) => [item, ...prev])
    setText('')
    toast('Email saved to your inbox.')
  }

  const answer = items.filter(needsAnswer)
  // An application deleted after linking counts as unlinked.
  const linked = (i: InboxItem) => apps.some((a) => a.id === i.application_id)
  const look = items.filter((i) => !needsAnswer(i) && !linked(i))
  const updates = items.filter((i) => !needsAnswer(i) && linked(i))

  return (
    <>
      <PageHeader title="Inbox" description="Sort employer emails, link them to applications and draft replies." />
      <Note icon={InboxIcon}>Jivika does not connect to your mailbox. You paste emails yourself, and they stay in this browser.</Note>
      <KeyNotice />
      <Card title="Paste an email from an employer" description="Jivika reads what they are asking for, which application it is about and any times they suggest.">
        <div className="space-y-3">
          <textarea
            className={`${textareaCls} min-h-40!`}
            aria-label="Email text"
            placeholder="Paste the whole email, including the sender and the greeting."
            maxLength={12000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="t-num text-xs text-faint">{text.length.toLocaleString()} / 12,000</span>
            <Button variant="brand" loading={loading} disabled={!text.trim() || !ready} onClick={read}>
              Read email
            </Button>
          </div>
          <ErrorMessage message={error} />
        </div>
      </Card>
      {items.length ? (
        <>
          <Section title="Needs an answer" description="The sender is waiting to hear from you." items={answer} apps={apps} />
          <Section title="Needs a look" description="Not linked to an application yet. Pick one so status changes and interviews land in the right place." items={look} apps={apps} />
          <Section title="Updates" description="Linked emails that need no reply." items={updates} apps={apps} />
        </>
      ) : (
        <Card>
          <EmptyState icon={<InboxIcon />} title="No emails yet" text="Paste an email from a recruiter or employer to see what it asks and keep your applications up to date." />
        </Card>
      )}
    </>
  )
}
