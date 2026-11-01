import { Send } from 'lucide-react'
import { api, useAction, useAiReady, type EmailTone } from '../lib/api'
import { useProfile, useStructuredProfile, type Application } from '../lib/store'
import { Button, ButtonLink, CopyButton, ErrorMessage, Field, inputCls, KeyNotice, Segmented, StatusBadge, textareaCls } from './ui'

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = (iso ?? '').split('-').map(Number)
  if (!y) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

export const safeLink = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

const TONES: { value: EmailTone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'warm', label: 'Warm' },
  { value: 'concise', label: 'Concise' },
]

export const mailtoHref = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

/** Status changes, newest first. */
export function StatusTimeline({ app }: { app: Application }) {
  return (
    <ol className="ml-[5px] border-l border-line" aria-label="Status timeline">
      {[...(app.history ?? [])].reverse().map((h, i) => (
        <li key={i} className="relative flex flex-wrap items-center gap-2 pb-2.5 pl-4 last:pb-0">
          <span className={`absolute top-2 -left-[4.5px] size-2 rounded-full ${i === 0 ? 'bg-brand-500' : 'bg-line-strong'}`} aria-hidden="true" />
          <StatusBadge status={h.status} />
          <span className="t-num text-xs text-muted">{formatDate(h.date)}</span>
        </li>
      ))}
    </ol>
  )
}

/** Application email draft: generate, edit, copy or open in the mail app. */
export function EmailPanel({ app: a, description, update }: { app: Application; description: string; update: (patch: Partial<Application>) => void }) {
  const [structured] = useStructuredProfile()
  const [profile] = useProfile()
  const ready = useAiReady()
  const email = useAction(api.applicationEmail)
  const tone = a.email?.tone ?? 'formal'
  const draft = a.email

  async function generateEmail() {
    const b = structured?.basics
    const r = await email.run({
      basics: {
        name: b?.name || profile?.name || '',
        email: b?.email || profile?.email || '',
        phone: b?.phone || profile?.phone || '',
        linkedin: b?.linkedin || profile?.linkedin || '',
      },
      job: { title: a.role, company: a.company, description },
      tone,
      resume_summary: (b?.summary || profile?.summary || '').slice(0, 2000) || undefined,
    })
    if (r) update({ email: { ...r, to: r.to ?? '', tone } })
  }

  return (
    <div className="space-y-3">
      <Segmented
        label="Email tone"
        size="sm"
        options={TONES}
        value={tone}
        onChange={(t) => update({ email: { to: draft?.to ?? '', subject: draft?.subject ?? '', body: draft?.body ?? '', tone: t } })}
      />
      <KeyNotice />
      <ErrorMessage message={email.error} />
      {draft && (draft.subject || draft.body) ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="To">
              <input type="email" className={inputCls} value={draft.to} onChange={(e) => update({ email: { ...draft, to: e.target.value } })} placeholder="recruiter@company.com" />
            </Field>
            <Field label="Subject">
              <input className={inputCls} value={draft.subject} onChange={(e) => update({ email: { ...draft, subject: e.target.value } })} />
            </Field>
          </div>
          <Field label="Body">
            <textarea className={`${textareaCls} field-sizing-content min-h-40`} value={draft.body} onChange={(e) => update({ email: { ...draft, body: e.target.value } })} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={`Subject: ${draft.subject}\n\n${draft.body}`} label="Copy email" />
            <ButtonLink href={mailtoHref(draft.to, draft.subject, draft.body)} size="sm" icon={Send}>
              Open in mail app
            </ButtonLink>
            <Button size="sm" variant="ghost" loading={email.loading} disabled={!ready} onClick={generateEmail}>
              Rewrite
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="brand" icon={Send} loading={email.loading} disabled={!ready} onClick={generateEmail}>
          Draft application email
        </Button>
      )}
    </div>
  )
}
