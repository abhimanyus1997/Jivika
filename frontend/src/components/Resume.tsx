import { FileText, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { api, useAction } from '../lib/api'
import { useResume } from '../lib/store'
import { ErrorMessage } from './ui'

const MAX_MB = 10

/** Drag-and-drop PDF upload. The parsed text is saved as the shared resume. */
export function ResumeDropzone({ compact = false }: { compact?: boolean }) {
  const [, setResume] = useResume()
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { run, loading, error, setError } = useAction(api.parseResume)

  async function handle(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_MB} MB.`)
      return
    }
    const parsed = await run(file)
    if (parsed) setResume({ ...parsed, fileName: file.name })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handle(e.dataTransfer.files[0])
        }}
        disabled={loading}
        className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 text-center transition-colors duration-150 disabled:cursor-wait ${
          compact ? 'py-5' : 'py-10'
        } ${dragging ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-canvas hover:border-brand-500 hover:bg-brand-50/40'}`}
      >
        <span className="mb-1 flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
          <Upload className={`size-4 ${loading ? 'animate-pulse' : ''}`} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="text-sm font-medium text-ink">
          {loading ? (
            'Reading your resume...'
          ) : (
            <>
              Drop your resume PDF or <span className="text-brand-600 underline underline-offset-2">browse</span>
            </>
          )}
        </span>
        <span className="text-xs text-faint">PDF up to {MAX_MB} MB. Text is extracted on the server and not stored.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload resume PDF"
        onChange={(e) => {
          void handle(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <ErrorMessage message={error} />
    </div>
  )
}

/** Shows which resume a tool will use, with an inline upload when none is saved. */
export function ResumeSource() {
  const [resume] = useResume()
  if (!resume?.text) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-muted">
          No resume saved yet. Upload one here or on the{' '}
          <a href="#profile" className="font-medium text-brand-600 underline underline-offset-2">
            Profile
          </a>{' '}
          page.
        </p>
        <ResumeDropzone compact />
      </div>
    )
  }
  return (
    <ResumeFileRow>
      <a href="#profile" className="text-xs font-medium text-brand-600 hover:underline">
        Change
      </a>
    </ResumeFileRow>
  )
}

/** File name and size of the saved resume. `children` renders on the right (e.g. a Change link). */
export function ResumeFileRow({ children }: { children?: ReactNode }) {
  const [resume] = useResume()
  if (!resume?.text) return null
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-[13px]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted">
        <FileText className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{resume.fileName || 'Saved resume'}</span>
        <span className="t-num block text-xs text-faint">
          {resume.pages > 0 && `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'} · `}
          {resume.characters.toLocaleString()} characters
        </span>
      </span>
      {children}
    </div>
  )
}
