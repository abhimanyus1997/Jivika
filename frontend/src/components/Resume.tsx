import { FileText, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, useAction, type ParserInfo } from '../lib/api'
import { useResume } from '../lib/store'
import { ErrorMessage } from './ui'

const MAX_MB = 10 // client-side ceiling; the server enforces its own (lower on Vercel) limit and explains it
const DOCLING_EXT = ['.pdf', '.docx', '.png', '.jpg', '.jpeg']
const DOCLING_ACCEPT = `application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,${DOCLING_EXT.join(',')}`

// Asked once per page load; servers without Docling (or without /api/parser) read PDFs only.
let parserInfo: Promise<ParserInfo> | null = null
function useParserInfo() {
  const [info, setInfo] = useState<ParserInfo>({ docling: false })
  useEffect(() => {
    let live = true
    parserInfo ??= api.parser().catch(() => {
      parserInfo = null // retry on the next mount instead of caching the failure
      return { docling: false } as ParserInfo
    })
    parserInfo.then((i) => live && setInfo(i))
    return () => {
      live = false
    }
  }, [])
  return info
}

/** Drag-and-drop PDF upload. The parsed text is saved as the shared resume. */
export function ResumeDropzone({ compact = false }: { compact?: boolean }) {
  const [, setResume] = useResume()
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { run, loading, error, setError } = useAction(api.parseResume)
  const { docling } = useParserInfo()

  async function handle(file: File | undefined) {
    if (!file) return
    const name = file.name.toLowerCase()
    const ok = docling ? DOCLING_EXT.some((x) => name.endsWith(x)) : file.type === 'application/pdf' || name.endsWith('.pdf')
    if (!ok) {
      setError(docling ? 'Please upload a PDF, DOCX, PNG or JPG file.' : 'Please upload a PDF file.')
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
              Drop your resume {docling ? 'file' : 'PDF'} or <span className="text-brand-600 underline underline-offset-2">browse</span>
            </>
          )}
        </span>
        <span className="text-xs text-faint">
          {docling ? 'PDF, DOCX, PNG or JPG.' : 'PDF only.'} Text is extracted on the server and not stored.
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={docling ? DOCLING_ACCEPT : 'application/pdf,.pdf'}
        className="sr-only"
        tabIndex={-1}
        aria-label={docling ? 'Upload resume file' : 'Upload resume PDF'}
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
        {resume.parser && (
          <span className={`block text-xs ${resume.parser === 'docling' ? 'text-brand-600' : 'text-faint'}`}>
            {resume.parser === 'docling' ? 'Parsed with Docling (layout-aware)' : 'Basic text extraction'}
          </span>
        )}
      </span>
      {children}
    </div>
  )
}
