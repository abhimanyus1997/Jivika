import { FileText, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
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
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
          compact ? 'py-5' : 'py-10'
        } ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50/50 hover:border-indigo-400'}`}
      >
        <UploadCloud className="size-7 text-indigo-600" aria-hidden="true" />
        <span className="text-sm font-medium text-slate-800">
          {loading ? 'Reading your resume...' : 'Drop your resume PDF here, or click to browse'}
        </span>
        <span className="text-xs text-slate-500">PDF up to {MAX_MB} MB. Text is extracted on the server and not stored.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
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
        <p className="text-sm text-slate-600">
          No resume saved yet. Upload one here or on the{' '}
          <a href="#profile" className="font-medium text-indigo-700 underline underline-offset-2">
            Profile
          </a>{' '}
          page.
        </p>
        <ResumeDropzone compact />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
      <FileText className="size-4 text-indigo-600" aria-hidden="true" />
      <span className="flex-1 truncate text-slate-700">
        Using <span className="font-medium text-slate-900">{resume.fileName || 'saved resume'}</span>{' '}
        <span className="tabular-nums text-slate-500">({resume.characters.toLocaleString()} characters)</span>
      </span>
      <a href="#profile" className="font-medium text-indigo-700 hover:underline">
        Change
      </a>
    </div>
  )
}
