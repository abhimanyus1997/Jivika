import { Scissors } from 'lucide-react'
import { useEffect } from 'react'
import { useStored } from '../lib/store'
import { Note } from './ui'

export const CLIPPER_URL = `${import.meta.env.BASE_URL}clipper/`

/** True once a job has ever arrived from Jivika Clipper. 'clip' is cleared by link imports, so it is latched. */
export function useClipReceived() {
  const [clip] = useStored<unknown>('clip', null)
  const [seen, setSeen] = useStored('clipReceived', false)
  useEffect(() => {
    if (clip != null && !seen) setSeen(true)
  }, [clip, seen, setSeen])
  return clip != null || seen
}

/** Dismissible card introducing the browser extension; hidden once dismissed or once a clip has been received. */
export function ClipperPromo() {
  const received = useClipReceived()
  const [dismissed, setDismissed] = useStored('clipperPromoDismissed', false)
  if (received || dismissed) return null
  return (
    <Note icon={Scissors} onDismiss={() => setDismissed(true)}>
      <span className="font-medium text-ink">Get Jivika Clipper</span>: send any job from LinkedIn, Naukri and other sites to Jivika with one click.{' '}
      <a href={CLIPPER_URL} className="font-medium text-brand-600 hover:underline">
        Install
      </a>
      {' · '}
      <a href={`${import.meta.env.BASE_URL}#clipper-title`} className="font-medium text-muted underline underline-offset-2 hover:text-ink">
        Learn more
      </a>
    </Note>
  )
}
