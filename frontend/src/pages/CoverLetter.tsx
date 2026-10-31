import '@fontsource/lora/400.css'
import '@fontsource/lora/400-italic.css'
import '@fontsource/lora/600.css'
import '@fontsource-variable/josefin-sans'
import '@fontsource/great-vibes'
import './cover-letter.css'
import { Download, Eraser, FileDown, Mail, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { JobImport } from '../components/JobImport'
import { ResumeSource } from '../components/Resume'
import {
  ActionHint,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  inputCls,
  KeyNotice,
  PageHeader,
  Segmented,
  Skeleton,
  textareaCls,
  toast,
} from '../components/ui'
import { api, useAction, useAiReady, type CoverLetterSender, type CoverLetterTone, type LetterParts, type Profile } from '../lib/api'
import {
  today,
  useCoverLetter,
  useJobDescription,
  useProfile,
  useResume,
  useSignature,
  type LetterTemplate,
  type SignatureMode,
} from '../lib/store'

const TONES: { value: CoverLetterTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'concise', label: 'Concise' },
]
const TEMPLATES: { value: LetterTemplate; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Modern' },
  { value: 'compact', label: 'Compact' },
]
const SIGNATURES: { value: SignatureMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'typed', label: 'Typed' },
  { value: 'drawn', label: 'Drawn' },
]
const SENDER_FIELDS: { key: keyof CoverLetterSender; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'title', label: 'Title' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'location', label: 'Location' },
  { key: 'linkedin', label: 'LinkedIn' },
]

const senderFromProfile = (p: Profile | null): CoverLetterSender => ({
  name: p?.name ?? '',
  title: p?.current_role || p?.headline || '',
  phone: p?.phone ?? '',
  email: p?.email ?? '',
  location: p?.location ?? '',
  linkedin: p?.linkedin ?? '',
})

/** Splits a plain letter (older servers, or letters saved before templates) into template parts. */
function partsFromText(text: string): LetterParts {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  let salutation = 'Dear Hiring Manager,'
  let sign_off = 'Sincerely,'
  if (blocks[0] && /^dear\b/i.test(blocks[0]) && blocks[0].length < 100) salutation = blocks.shift()!
  const last = blocks.at(-1)
  if (last && last.length < 120 && /^(sincerely|regards|kind regards|best|warm regards|yours|thank you|with thanks)/i.test(last)) {
    sign_off = last.split('\n')[0]
    blocks.pop()
  }
  return { recipient_name: '', recipient_title: '', company: '', recipient_contact: '', job_reference: '', salutation, paragraphs: blocks, sign_off }
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

/** '14th August 2026' from yyyy-mm-dd. */
function formatLetterDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' })
  return `${ordinal(d)} ${month} ${y}`
}

/** Text for copying into an application form: salutation to signature, no letterhead. */
function plainText(parts: LetterParts, name: string) {
  return [parts.salutation, ...parts.paragraphs, [parts.sign_off, name].filter(Boolean).join('\n')]
    .map((b) => b.trim())
    .filter(Boolean)
    .join('\n\n')
}

function downloadText(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'cover-letter.txt'
  a.click()
  URL.revokeObjectURL(url)
  toast('Downloaded cover-letter.txt')
}

interface DocProps {
  parts: LetterParts
  sender: CoverLetterSender
  template: LetterTemplate
  date: string
  signature: SignatureMode
  drawn: string
}

/** The letter itself, rendered the same on screen and in print. */
function LetterDoc({ parts, sender, template, date, signature, drawn }: DocProps) {
  const contact = [sender.phone, sender.email, sender.location, sender.linkedin].filter((x) => x.trim())
  const recipient = [parts.recipient_name, parts.recipient_title, parts.company, parts.recipient_contact].filter((x) => x.trim())
  return (
    <article className="letter" data-template={template}>
      <header className="lt-head">
        <div className="min-w-0">
          <h2 className="lt-name">{sender.name || 'Your name'}</h2>
          {sender.title && <p className="lt-title">{sender.title}</p>}
        </div>
        {contact.length > 0 && (
          <address className="lt-contact">
            {contact.map((c, i) => (
              <span key={i} className="block">
                {c}
              </span>
            ))}
          </address>
        )}
      </header>
      <hr className="lt-rule" />
      {date && <p className="lt-date">{formatLetterDate(date)}</p>}
      {recipient.length > 0 && <p className="lt-recipient">{recipient.join('\n')}</p>}
      {parts.job_reference && <p className="lt-ref">Job reference: {parts.job_reference}</p>}
      <div className="lt-body">
        {parts.salutation && <p>{parts.salutation}</p>}
        {parts.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <div className="lt-sign">
          {parts.sign_off && <p>{parts.sign_off}</p>}
          {signature === 'typed' && sender.name && (
            <span className="lt-script" aria-hidden="true">
              {sender.name}
            </span>
          )}
          {signature === 'drawn' && drawn && <img src={drawn} alt="Signature" />}
          {sender.name && <p>{sender.name}</p>}
        </div>
      </div>
    </article>
  )
}

/** Scales the 210 mm page down to fit narrow columns (print is unaffected). */
function PaperPreview(props: DocProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / 794)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrap} className="w-full">
      <div className="mx-auto w-fit rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_-6px_rgba(0,0,0,0.18)]" style={{ zoom }}>
        <LetterDoc {...props} />
      </div>
    </div>
  )
}

/** Canvas pad for a drawn signature, saved as a PNG data URL. */
function SignaturePad({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  // Restore the saved signature when the pad mounts; later strokes are drawn straight onto the canvas.
  const initial = useRef(value)
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !initial.current) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height)
    img.src = initial.current
  }, [])

  function clear() {
    const c = canvas.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    onChange('')
  }

  function point(e: ReactPointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height] as const
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={600}
        height={180}
        aria-label="Signature pad. Draw your signature with a mouse, pen or finger."
        className="block h-[120px] w-full cursor-crosshair touch-none rounded-lg border border-dashed border-line-strong bg-white"
        onPointerDown={(e) => {
          const ctx = canvas.current?.getContext('2d')
          if (!ctx) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const [x, y] = point(e)
          ctx.strokeStyle = '#1c1b19'
          ctx.lineWidth = 3
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(x, y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = canvas.current?.getContext('2d')
          const [x, y] = point(e)
          ctx?.lineTo(x, y)
          ctx?.stroke()
        }}
        onPointerUp={() => {
          if (!drawing.current) return
          drawing.current = false
          onChange(canvas.current!.toDataURL('image/png'))
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-faint">Saved in this browser only.</span>
        <Button size="sm" variant="ghost" icon={Eraser} onClick={clear} disabled={!value}>
          Clear
        </Button>
      </div>
    </div>
  )
}

export default function CoverLetter() {
  const [resume] = useResume()
  const [profile] = useProfile()
  const [jd, setJd] = useJobDescription()
  const [letter, setLetter] = useCoverLetter()
  const [drawn, setDrawn] = useSignature()
  const key = useAiReady()
  const action = useAction(api.coverLetter)

  const recipient = letter.recipient ?? { name: '', title: '', company: '' }
  const sender = letter.sender ?? senderFromProfile(profile)
  const parts = letter.parts ?? (letter.text.trim() ? partsFromText(letter.text) : null)
  const template = letter.template ?? 'classic'
  const signature = letter.signature ?? 'none'
  const date = letter.date || today()
  const doc: DocProps | null = parts && { parts, sender, template, date, signature, drawn }
  const text = parts ? plainText(parts, sender.name) : ''
  const words = parts ? parts.paragraphs.join(' ').trim().split(/\s+/).filter(Boolean).length : 0

  const setParts = (patch: Partial<LetterParts>) => parts && setLetter((l) => ({ ...l, parts: { ...parts, ...patch } }))
  const setSender = (k: keyof CoverLetterSender, v: string) => setLetter((l) => ({ ...l, sender: { ...sender, [k]: v } }))

  async function generate() {
    if (!resume?.text) return
    const hasSender = Object.values(sender).some((v) => v.trim())
    const r = await action.run({
      resume: resume.text,
      job_description: jd,
      tone: letter.tone,
      // The server caps each detail at 200 characters.
      sender: hasSender ? (Object.fromEntries(Object.entries(sender).map(([k, v]) => [k, v.trim().slice(0, 200)])) as CoverLetterSender) : undefined,
      recipient_name: recipient.name.trim().slice(0, 200) || undefined,
      recipient_title: recipient.title.trim().slice(0, 200) || undefined,
      company: recipient.company.trim().slice(0, 200) || undefined,
    })
    if (r) setLetter((l) => ({ ...l, text: r.cover_letter, parts: r.letter ?? partsFromText(r.cover_letter) }))
  }

  function printLetter() {
    // The browser names the PDF after the document title.
    const title = document.title
    document.title = ['Cover letter', sender.name, parts?.company].filter(Boolean).join(' - ')
    window.addEventListener('afterprint', () => (document.title = title), { once: true })
    toast('Choose "Save as PDF" as the destination to download the letter.')
    window.print()
  }

  return (
    <>
      <PageHeader
        title="Cover letter"
        description="Draft a cover letter grounded in your resume and the job description, then pick a template and export it as a PDF."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-6 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Inputs" description="The letter only uses facts from your resume.">
            <div className="space-y-4">
              <ResumeSource />
              <JobImport onImport={(t) => setJd(t)} />
              <Field label="Job description">
                <textarea className={`${textareaCls} min-h-40`} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description." />
              </Field>
              <details className="rounded-lg border border-line px-3 py-2">
                <summary className="text-[13px] font-medium text-ink">Recipient (optional)</summary>
                <p className="mt-1 text-xs text-muted">Leave blank if you do not know them. The letter will address the hiring manager.</p>
                <div className="mt-3 space-y-3 pb-1">
                  {(['name', 'title', 'company'] as const).map((k) => (
                    <Field key={k} label={k === 'name' ? 'Recipient name' : k === 'title' ? 'Recipient title' : 'Company'}>
                      <input
                        className={inputCls}
                        value={recipient[k]}
                        onChange={(e) => setLetter((l) => ({ ...l, recipient: { ...recipient, [k]: e.target.value } }))}
                      />
                    </Field>
                  ))}
                </div>
              </details>
              <div>
                <span className="t-label mb-1.5 block">Tone</span>
                <Segmented label="Tone" options={TONES} value={letter.tone} onChange={(tone) => setLetter((l) => ({ ...l, tone }))} />
              </div>
              <KeyNotice />
              <ErrorMessage message={action.error} />
              <Button
                variant="brand"
                icon={Mail}
                className="w-full"
                onClick={generate}
                loading={action.loading}
                disabled={!key || !resume?.text || jd.trim().length < 30}
              >
                {parts ? 'Rewrite cover letter' : 'Write cover letter'}
              </Button>
              <ActionHint show={key && resume?.text && jd.trim().length < 30}>Paste at least a few lines of the job description to continue.</ActionHint>
            </div>
          </Card>

          {parts && (
            <Card title="Edit letter" description="Changes show in the preview straight away." divider>
              <div className="space-y-5">
                <fieldset className="space-y-3">
                  <legend className="t-overline mb-2">Your details</legend>
                  <div className="grid grid-cols-2 gap-3">
                    {SENDER_FIELDS.map((f) => (
                      <Field key={f.key} label={f.label}>
                        <input type={f.type ?? 'text'} className={inputCls} value={sender[f.key]} onChange={(e) => setSender(f.key, e.target.value)} />
                      </Field>
                    ))}
                  </div>
                  {letter.sender && (
                    <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setLetter((l) => ({ ...l, sender: undefined }))}>
                      Reset to profile details
                    </button>
                  )}
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="t-overline mb-2">Recipient</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name">
                      <input className={inputCls} value={parts.recipient_name} onChange={(e) => setParts({ recipient_name: e.target.value })} />
                    </Field>
                    <Field label="Title">
                      <input className={inputCls} value={parts.recipient_title} onChange={(e) => setParts({ recipient_title: e.target.value })} />
                    </Field>
                    <Field label="Company">
                      <input className={inputCls} value={parts.company} onChange={(e) => setParts({ company: e.target.value })} />
                    </Field>
                    <Field label="Job reference">
                      <input className={inputCls} value={parts.job_reference} onChange={(e) => setParts({ job_reference: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Contact or address" hint="Optional.">
                    <textarea
                      className={`${textareaCls} field-sizing-content min-h-16`}
                      value={parts.recipient_contact}
                      onChange={(e) => setParts({ recipient_contact: e.target.value })}
                    />
                  </Field>
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="t-overline mb-2">Letter</legend>
                  <Field label="Date">
                    <input type="date" className={`${inputCls} t-num`} value={date} onChange={(e) => setLetter((l) => ({ ...l, date: e.target.value }))} />
                  </Field>
                  <Field label="Salutation">
                    <input className={inputCls} value={parts.salutation} onChange={(e) => setParts({ salutation: e.target.value })} />
                  </Field>
                  {parts.paragraphs.map((p, i) => (
                    <div key={i} className="relative">
                      <span className="t-label mb-1.5 block" aria-hidden="true">
                        Paragraph {i + 1}
                      </span>
                      <textarea
                        aria-label={`Paragraph ${i + 1}`}
                        className={`${textareaCls} field-sizing-content min-h-24`}
                        value={p}
                        spellCheck
                        onChange={(e) => setParts({ paragraphs: parts.paragraphs.map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        label={`Remove paragraph ${i + 1}`}
                        className="absolute -top-1 right-0"
                        onClick={() => setParts({ paragraphs: parts.paragraphs.filter((_, j) => j !== i) })}
                      />
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => setParts({ paragraphs: [...parts.paragraphs, ''] })}>
                    Add paragraph
                  </Button>
                  <Field label="Sign-off">
                    <input className={inputCls} value={parts.sign_off} onChange={(e) => setParts({ sign_off: e.target.value })} />
                  </Field>
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="t-overline mb-2">Signature</legend>
                  <Segmented label="Signature" options={SIGNATURES} value={signature} onChange={(s) => setLetter((l) => ({ ...l, signature: s }))} />
                  {signature === 'typed' && !sender.name && <p className="text-xs text-muted">Add your name above to show a typed signature.</p>}
                  {signature === 'drawn' && <SignaturePad value={drawn} onChange={setDrawn} />}
                </fieldset>
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {action.loading ? (
            <Card padding={false}>
              <div role="status" aria-label="Writing cover letter" className="mx-auto max-w-prose space-y-3 px-6 py-10 md:px-10">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="mt-6 h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="mt-6 h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </Card>
          ) : doc ? (
            <Card
              padding={false}
              divider
              title="Preview"
              description={
                <span className="t-num">
                  A4 · {words} {words === 1 ? 'word' : 'words'}
                </span>
              }
              action={
                <>
                  <CopyButton text={text} label="Copy cover letter text" />
                  <IconButton icon={Download} label="Download as text file" onClick={() => downloadText(text)} />
                  <Button size="sm" variant="brand" icon={FileDown} onClick={printLetter}>
                    Download PDF
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
                <span className="t-label">Template</span>
                <Segmented label="Template" size="sm" options={TEMPLATES} value={template} onChange={(t) => setLetter((l) => ({ ...l, template: t }))} />
              </div>
              <div className="rounded-b-xl bg-subtle p-3 md:p-6">
                <PaperPreview {...doc} />
              </div>
              {createPortal(
                <div className="letter-print" data-template={template} aria-hidden="true">
                  <LetterDoc {...doc} />
                </div>,
                document.body,
              )}
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<Mail strokeWidth={1.75} />}
                title="No cover letter yet"
                text="Your draft will appear here on an A4 page, ready to edit, export as a PDF, copy or download."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
