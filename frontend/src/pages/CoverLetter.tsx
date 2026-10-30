import { Download, Mail } from 'lucide-react'
import { ResumeSource } from '../components/Resume'
import { Button, Card, CopyButton, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ActionHint } from '../components/ui'
import { api, useAction, type CoverLetterTone } from '../lib/api'
import { useApiKey, useCoverLetter, useJobDescription, useResume } from '../lib/store'

const TONES: CoverLetterTone[] = ['professional', 'enthusiastic', 'concise']

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'cover-letter.txt'
  a.click()
  URL.revokeObjectURL(url)
}

export default function CoverLetter() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [letter, setLetter] = useCoverLetter()
  const key = useApiKey()
  const action = useAction(api.coverLetter)

  async function generate() {
    if (!resume?.text) return
    const r = await action.run(resume.text, jd, letter.tone)
    if (r) setLetter({ ...letter, text: r.cover_letter })
  }

  return (
    <>
      <PageIntro>Draft a cover letter grounded in your resume and the job description. Edit it freely before sending.</PageIntro>
      <Card>
        <div className="space-y-4">
          <ResumeSource />
          <Field label="Job description">
            <textarea className={`${inputCls} h-40`} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description." />
          </Field>
          <Field label="Tone">
            <select
              className={`${inputCls} max-w-xs capitalize`}
              value={letter.tone}
              onChange={(e) => setLetter({ ...letter, tone: e.target.value as CoverLetterTone })}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <KeyNotice />
          <ErrorMessage message={action.error} />
          <Button onClick={generate} loading={action.loading} disabled={!key || !resume?.text || jd.trim().length < 30}>
            <Mail className="size-4" aria-hidden="true" />
            Write cover letter
          </Button>
          <ActionHint show={key && resume?.text && jd.trim().length < 30}>Paste at least a few lines of the job description to continue.</ActionHint>
        </div>
      </Card>

      {letter.text ? (
        <Card
          title="Your cover letter"
          action={
            <div className="flex items-center gap-1">
              <CopyButton text={letter.text} label="Copy cover letter" />
              <button
                type="button"
                onClick={() => download(letter.text)}
                aria-label="Download as text file"
                title="Download .txt"
                className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <Download className="size-4" aria-hidden="true" />
              </button>
            </div>
          }
        >
          <textarea
            aria-label="Cover letter"
            className={`${inputCls} h-96 leading-relaxed`}
            value={letter.text}
            onChange={(e) => setLetter({ ...letter, text: e.target.value })}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<Mail className="size-8" />} title="No cover letter yet" text="Your draft will appear here, ready to copy or download." />
        </Card>
      )}
    </>
  )
}
