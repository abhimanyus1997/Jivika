import { Link2 } from 'lucide-react'
import { useId, useState } from 'react'
import { api, ApiError, importedJobText, SOURCE_LABEL, useAction, type ImportedJob } from '../lib/api'
import { useStored } from '../lib/store'
import { CLIPPER_URL } from './ClipperPromo'
import { Badge, Button, ErrorMessage, inputCls } from './ui'

const BLOCKING_HOSTS = /(^|\.)(naukri|linkedin)\.com$/i
const host = (link: string) => {
  try {
    return new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`).hostname
  } catch {
    return ''
  }
}

const importJob = async (url: string) => {
  try {
    return await api.importJob(url)
  } catch (e) {
    // The endpoint answers 404 when JIVIKA_URL_IMPORT=0.
    if (e instanceof ApiError && e.status === 404) throw new Error('Importing from links is turned off on this server. Paste the job description instead.')
    throw e
  }
}

/**
 * "Import from link" row placed above a job description textarea. On success it hands the
 * description (with a short title/company header) to `onImport` and shows what was fetched.
 */
export function JobImport({ onImport }: { onImport: (text: string, job: ImportedJob) => void }) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [imported, setJob] = useState<ImportedJob | null>(null)
  // Set by the Jivika Clipper receiver (lib/clip.ts); a link import replaces it.
  const [clipped, setClipped] = useStored<ImportedJob | null>('clip', null)
  const job = imported ?? clipped
  const action = useAction(importJob)
  const blocked = !!action.error && (action.error.includes('Blocked by the source') || BLOCKING_HOSTS.test(host(url)))
  async function run() {
    setJob(null)
    setClipped(null)
    // Links are often pasted without a scheme (linkedin.com/jobs/view/123).
    const link = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
    if (!/^https?:\/\/\S+\.\S+/i.test(link)) {
      action.setError('Enter a full job link, for example https://www.linkedin.com/jobs/view/123')
      return
    }
    const r = await action.run(link)
    if (!r) return
    if (!r.description.trim()) {
      action.setError('No job description was found on that page. Paste it instead.')
      return
    }
    setJob(r)
    onImport(importedJobText(r), r)
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="t-label block">
        Import from link
      </label>
      <form
        noValidate
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input
          id={id}
          type="url"
          inputMode="url"
          className={inputCls}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            action.setError('')
          }}
          placeholder="LinkedIn, Naukri or company careers link"
          aria-describedby={`${id}-hint`}
          spellCheck={false}
        />
        <Button type="submit" variant="secondary" icon={Link2} loading={action.loading} disabled={!url.trim()}>
          Import
        </Button>
      </form>
      <ErrorMessage message={action.error} />
      {blocked && (
        <p className="text-xs leading-4 text-muted">
          This site blocks server imports.{' '}
          <a href={CLIPPER_URL} className="font-medium text-brand-600 hover:underline">
            Use Jivika Clipper
          </a>{' '}
          to send this job from your browser.
        </p>
      )}
      {job && !action.loading ? (
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <Badge tone="brand" dot>
            {SOURCE_LABEL[job.source] ?? job.source}
          </Badge>
          <span className="min-w-0 truncate text-ink">
            <span className="font-medium">{job.title || 'Untitled role'}</span>
            {job.company && <span className="text-muted"> at {job.company}</span>}
          </span>
        </div>
      ) : (
        <p id={`${id}-hint`} className="text-xs leading-4 text-faint">
          Fills the job description below. You can still edit or paste it.
        </p>
      )}
    </div>
  )
}
