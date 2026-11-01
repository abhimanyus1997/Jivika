import { ExternalLink, FileUser, Mail, Pencil, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { api, useAction, useAiReady, type EmailTone } from '../lib/api'
import {
  read,
  STATUSES,
  tailoredFor,
  useApplications,
  useProfile,
  useStructuredProfile,
  useTailoredResumes,
  withStatus,
  write,
  type Application,
  type CoverLetterState,
  type Status,
} from '../lib/store'
import { requestTailor } from '../pages/Resume'
import {
  ActionHint,
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  ErrorMessage,
  Field,
  inputCls,
  KeyNotice,
  Modal,
  Segmented,
  StatusBadge,
  textareaCls,
} from './ui'

export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const safeLink = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)

const TONES: { value: EmailTone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'warm', label: 'Warm' },
  { value: 'concise', label: 'Concise' },
]

export const mailtoHref = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2.5 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-overline">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Application detail: status timeline, notes, job description, tailored resume, cover letter and email draft. */
export function ApplicationDetail({ appId, onClose, onEdit }: { appId: string | null; onClose: () => void; onEdit: (a: Application) => void }) {
  const [apps, setApps] = useApplications()
  const [tailored] = useTailoredResumes()
  const [structured] = useStructuredProfile()
  const [profile] = useProfile()
  const ready = useAiReady()
  const email = useAction(api.applicationEmail)
  const a = apps.find((x) => x.id === appId)
  const update = (patch: Partial<Application> | ((a: Application) => Application)) =>
    setApps((list) => list.map((x) => (x.id === appId ? (typeof patch === 'function' ? patch(x) : { ...x, ...patch }) : x)))

  const resume = a && tailoredFor(tailored, a.id)
  // Applications tracked before descriptions were stored fall back to the job a resume was tailored to.
  const description = a?.description ?? resume?.job.description ?? ''
  const tone = a?.email?.tone ?? 'formal'
  const draft = a?.email

  async function generateEmail() {
    if (!a) return
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

  function openCoverLetter() {
    if (!a) return
    if (description.trim()) write('jd', description)
    const cl = read<CoverLetterState>('coverLetter', { tone: 'professional', text: '' })
    write('coverLetter', { ...cl, recipient: { name: cl.recipient?.name ?? '', title: cl.recipient?.title ?? '', company: a.company } })
    location.hash = 'cover-letter'
  }

  return (
    <Modal
      open={!!a}
      onClose={onClose}
      title={a ? `${a.role || 'Role'} at ${a.company || 'company'}` : 'Application'}
      description={a && `Applied ${formatDate(a.date)}`}
      width="max-w-2xl"
      footer={
        <>
          {a && (
            <Button variant="secondary" icon={Pencil} onClick={() => onEdit(a)}>
              Edit details
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {a && (
        <div className="space-y-5">
          <Section title="Status">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <span>Status</span>
                <select data-autofocus className={`${inputCls} w-48`} value={a.status} onChange={(e) => update((x) => withStatus(x, e.target.value as Status))}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {typeof a.match === 'number' && <Badge tone="brand" mono>{a.match}% match</Badge>}
              {a.link && (
                <a
                  href={safeLink(a.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
                >
                  Job posting <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                </a>
              )}
            </div>
            <ol className="ml-[5px] border-l border-line" aria-label="Status timeline">
              {[...(a.history ?? [])].reverse().map((h, i) => (
                <li key={i} className="relative flex flex-wrap items-center gap-2 pb-2.5 pl-4 last:pb-0">
                  <span className={`absolute top-2 -left-[4.5px] size-2 rounded-full ${i === 0 ? 'bg-brand-500' : 'bg-line-strong'}`} aria-hidden="true" />
                  <StatusBadge status={h.status} />
                  <span className="t-num text-xs text-muted">{formatDate(h.date)}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Notes">
            <textarea
              aria-label="Notes"
              className={`${textareaCls} field-sizing-content min-h-20`}
              value={a.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Contacts, interview dates, follow-ups."
            />
          </Section>

          <Section title="Job description">
            <textarea
              aria-label="Job description"
              className={`${textareaCls} min-h-28`}
              value={description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Paste the job description to tailor a resume, write a cover letter or draft an email."
            />
          </Section>

          <Section title="Resume and cover letter">
            <div className="flex flex-wrap gap-2">
              {resume ? (
                <ButtonLink href={`#resume?tailor=${resume.id}`} size="sm" icon={FileUser}>
                  Open tailored resume
                </ButtonLink>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={FileUser}
                  disabled={description.trim().length < 30 || !ready}
                  onClick={() => requestTailor({ appId: a.id, job: { title: a.role, company: a.company, description } })}
                >
                  Tailor resume
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={Mail} onClick={openCoverLetter}>
                Write cover letter
              </Button>
            </div>
            <ActionHint show={!resume && description.trim().length < 30}>Add the job description to tailor a resume.</ActionHint>
          </Section>

          <Section title="Email draft" action={<Segmented label="Email tone" size="sm" options={TONES} value={tone} onChange={(t) => update({ email: { to: draft?.to ?? '', subject: draft?.subject ?? '', body: draft?.body ?? '', tone: t } })} />}>
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
          </Section>
        </div>
      )}
    </Modal>
  )
}
