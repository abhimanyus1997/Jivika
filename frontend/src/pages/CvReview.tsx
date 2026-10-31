import { FileCheck2, Zap } from 'lucide-react'
import { useState } from 'react'
import { ResumeSource } from '../components/Resume'
import {
  ActionHint,
  Badge,
  BeforeAfter,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  KeyNotice,
  PageHeader,
  ProgressBar,
  ScoreRing,
  scoreBand,
  SkeletonCard,
} from '../components/ui'
import { api, useAction, useAiReady, type CVReview } from '../lib/api'
import { pushHistory, useCvReview, useProfile, useResume } from '../lib/store'

export default function CvReview() {
  const [resume] = useResume()
  const [profile] = useProfile()
  const [review, setReview] = useCvReview()
  const [target, setTarget] = useState(profile?.current_role ?? '')
  const key = useAiReady()
  const action = useAction(api.cvReview)

  async function run() {
    if (!resume?.text) return
    const r = await action.run(resume.text, target.trim())
    if (r) {
      setReview(r)
      pushHistory('cv', r.ats_score)
    }
  }

  return (
    <>
      <PageHeader title="CV review" description="See how applicant tracking systems and recruiters read your CV, with concrete rewrites." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Review setup" description="Uses the resume saved in your profile.">
            <div className="space-y-4">
              <ResumeSource />
              <Field label="Target role" hint="Optional. Tailors the review to a specific role.">
                <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. Senior data analyst" />
              </Field>
              <KeyNotice />
              <ErrorMessage message={action.error} />
              <Button variant="brand" icon={FileCheck2} onClick={run} loading={action.loading} disabled={!key || !resume?.text} className="w-full">
                {review ? 'Review again' : 'Review CV'}
              </Button>
              <ActionHint show={key && !resume?.text}>Upload a resume to continue.</ActionHint>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {action.loading ? (
            <>
              <SkeletonCard lines={3} label="Reviewing your CV" />
              <SkeletonCard lines={5} label="Scoring sections" />
            </>
          ) : !review ? (
            <Card>
              <EmptyState
                icon={<FileCheck2 strokeWidth={1.75} />}
                title="No review yet"
                text="Your ATS score, section feedback and bullet rewrites will appear here."
              />
            </Card>
          ) : (
            <Results review={review} />
          )}
        </div>
      </div>
    </>
  )
}

function Results({ review }: { review: CVReview }) {
  const band = scoreBand(review.ats_score)
  return (
    <>
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing value={review.ats_score} label="ATS score" size={112} showLabel={false} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-title">ATS score</h2>
              <Badge tone={band.tone} dot>
                {band.label}
              </Badge>
            </div>
            <p className="text-sm text-muted">{review.overall}</p>
          </div>
        </div>
      </Card>

      <Card title="Section scores" description="How each part of your CV holds up." padding={false}>
        <ul className="divide-y divide-line border-t border-line">
          {review.sections.map((s) => (
            <li key={s.name} className="px-5 py-4">
              <ProgressBar value={s.score} label={s.name} suffix="/100" />
              <p className="mt-2 text-[13px] leading-5 text-muted">{s.feedback}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Bullet rewrites"
        description="Original wording, followed by a stronger version you can copy."
        action={review.bullet_rewrites.length > 0 && <Badge mono>{review.bullet_rewrites.length}</Badge>}
      >
        {review.bullet_rewrites.length ? (
          <ul className="space-y-5">
            {review.bullet_rewrites.map((b, i) => (
              <li key={i}>
                <BeforeAfter before={b.original} after={b.improved} label={`Bullet ${i + 1}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No rewrites suggested.</p>
        )}
      </Card>

      <Card title="Quick wins" description="Small changes with an outsized effect.">
        {review.quick_wins.length ? (
          <ul className="space-y-2.5">
            {review.quick_wins.map((w, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-50">
                  <Zap className="size-3 text-accent-700" strokeWidth={1.75} aria-hidden="true" />
                </span>
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">None noted.</p>
        )}
      </Card>
    </>
  )
}
