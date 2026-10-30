import { FileCheck2, Zap } from 'lucide-react'
import { useState } from 'react'
import { ResumeSource } from '../components/Resume'
import { Button, Card, CopyButton, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ProgressBar, ScoreRing } from '../components/ui'
import { api, useAction } from '../lib/api'
import { pushHistory, useApiKey, useCvReview, useProfile, useResume } from '../lib/store'

export default function CvReview() {
  const [resume] = useResume()
  const [profile] = useProfile()
  const [review, setReview] = useCvReview()
  const [target, setTarget] = useState(profile?.current_role ?? '')
  const key = useApiKey()
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
      <PageIntro>Check how applicant tracking systems and recruiters will read your CV, and get concrete rewrites.</PageIntro>
      <Card>
        <div className="space-y-4">
          <ResumeSource />
          <Field label="Target role" hint="Optional. Tailors the review to a specific role.">
            <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. Senior Data Analyst" />
          </Field>
          <KeyNotice />
          <ErrorMessage message={action.error} />
          <Button onClick={run} loading={action.loading} disabled={!key || !resume?.text}>
            <FileCheck2 className="size-4" aria-hidden="true" />
            Review CV
          </Button>
        </div>
      </Card>

      {!review ? (
        <Card>
          <EmptyState icon={<FileCheck2 className="size-8" />} title="No review yet" text="Your ATS score, section feedback and bullet rewrites will appear here." />
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="flex flex-col items-center justify-center gap-4">
              <ScoreRing value={review.ats_score} label="ATS score" size={160} />
              <p className="text-center text-sm text-slate-600">{review.overall}</p>
            </Card>
            <Card title="Section scores" className="lg:col-span-2">
              <ul className="space-y-4">
                {review.sections.map((s) => (
                  <li key={s.name}>
                    <ProgressBar value={s.score} label={s.name} suffix="/100" />
                    <p className="mt-1 text-xs text-slate-600">{s.feedback}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Bullet rewrites">
            {review.bullet_rewrites.length ? (
              <ul className="space-y-4">
                {review.bullet_rewrites.map((b, i) => (
                  <li key={i} className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Original</div>
                      <p className="text-sm text-slate-700">{b.original}</p>
                    </div>
                    <div className="flex gap-2 rounded-xl bg-emerald-50 p-4">
                      <div className="flex-1">
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-800">Improved</div>
                        <p className="text-sm text-slate-900">{b.improved}</p>
                      </div>
                      <CopyButton text={b.improved} label="Copy improved bullet" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No rewrites suggested.</p>
            )}
          </Card>

          <Card title="Quick wins">
            <ul className="space-y-2">
              {review.quick_wins.map((w, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-700">
                  <Zap className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  )
}
