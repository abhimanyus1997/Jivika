import { Download, Mail } from 'lucide-react'
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
  KeyNotice,
  PageHeader,
  Segmented,
  Skeleton,
  textareaCls,
  toast,
} from '../components/ui'
import { api, useAction, useAiReady, type CoverLetterTone } from '../lib/api'
import { useCoverLetter, useJobDescription, useResume } from '../lib/store'

const TONES: { value: CoverLetterTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
  { value: 'concise', label: 'Concise' },
]

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'cover-letter.txt'
  a.click()
  URL.revokeObjectURL(url)
  toast('Downloaded cover-letter.txt')
}

export default function CoverLetter() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [letter, setLetter] = useCoverLetter()
  const key = useAiReady()
  const action = useAction(api.coverLetter)
  const words = letter.text.trim() ? letter.text.trim().split(/\s+/).length : 0

  async function generate() {
    if (!resume?.text) return
    const r = await action.run(resume.text, jd, letter.tone)
    if (r) setLetter({ ...letter, text: r.cover_letter })
  }

  return (
    <>
      <PageHeader
        title="Cover letter"
        description="Draft a cover letter grounded in your resume and the job description. Edit it freely before sending."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Inputs" description="The letter only uses facts from your resume.">
            <div className="space-y-4">
              <ResumeSource />
              <Field label="Job description">
                <textarea
                  className={`${textareaCls} min-h-40`}
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Paste the job description."
                />
              </Field>
              <div>
                <span className="t-label mb-1.5 block">Tone</span>
                <Segmented
                  label="Tone"
                  options={TONES}
                  value={letter.tone}
                  onChange={(tone) => setLetter({ ...letter, tone })}
                />
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
                {letter.text ? 'Rewrite cover letter' : 'Write cover letter'}
              </Button>
              <ActionHint show={key && resume?.text && jd.trim().length < 30}>
                Paste at least a few lines of the job description to continue.
              </ActionHint>
            </div>
          </Card>
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
          ) : letter.text ? (
            <Card
              padding={false}
              divider
              title="Draft"
              description={
                <span className="t-num">
                  {words} {words === 1 ? 'word' : 'words'}
                </span>
              }
              action={
                <>
                  <CopyButton text={letter.text} label="Copy cover letter" />
                  <IconButton icon={Download} label="Download as text file" onClick={() => download(letter.text)} />
                </>
              }
            >
              <div className="bg-canvas p-3 md:p-6">
                <div className="mx-auto max-w-[72ch] rounded-lg border border-line bg-surface px-6 py-8 shadow-card transition-colors duration-150 focus-within:border-brand-500 md:px-12 md:py-12">
                  <textarea
                    aria-label="Cover letter"
                    className="field-sizing-content block min-h-[28rem] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-7 text-ink focus:outline-none"
                    value={letter.text}
                    onChange={(e) => setLetter({ ...letter, text: e.target.value })}
                    spellCheck
                  />
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<Mail strokeWidth={1.75} />}
                title="No cover letter yet"
                text="Your draft will appear here as an editable document, ready to copy or download."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
