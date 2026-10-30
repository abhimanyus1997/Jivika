import { BookOpen, Route } from 'lucide-react'
import { ResumeSource } from '../components/Resume'
import { Button, Card, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ScoreRing } from '../components/ui'
import { api, CURRENCIES, useAction, type Currency } from '../lib/api'
import { pushHistory, useApiKey, useCareerPath, useProfile, useResume, useStored } from '../lib/store'
import { CareerTimeline } from './Dashboard'

export default function CareerPathPage() {
  const [resume] = useResume()
  const [profile] = useProfile()
  const [path, setPath] = useCareerPath()
  const [form, setForm] = useStored('careerInput', {
    current_role: profile?.current_role ?? '',
    target_role: '',
    location: profile?.location ?? '',
    currency: 'INR' as Currency,
  })
  const key = useApiKey()
  const action = useAction(api.careerPath)

  async function run() {
    if (!resume?.text) return
    const r = await action.run({
      resume: resume.text,
      current_role: form.current_role.trim(),
      target_role: form.target_role.trim() || undefined,
      location: form.location.trim() || undefined,
      currency: form.currency,
    })
    if (r) {
      setPath(r)
      pushHistory('career', r.career_score)
    }
  }

  return (
    <>
      <PageIntro>See a realistic next step and longer-term direction based on your experience, with the skills to build along the way.</PageIntro>
      <Card>
        <div className="space-y-4">
          <ResumeSource />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Current role">
              <input className={inputCls} value={form.current_role} onChange={(e) => setForm({ ...form, current_role: e.target.value })} />
            </Field>
            <Field label="Target role" hint="Optional.">
              <input className={inputCls} value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value })} />
            </Field>
            <Field label="Location" hint="Optional. Improves salary estimates.">
              <input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <Field label="Currency">
              <select className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <KeyNotice />
          <ErrorMessage message={action.error} />
          <Button onClick={run} loading={action.loading} disabled={!key || !resume?.text || !form.current_role.trim()}>
            <Route className="size-4" aria-hidden="true" />
            Map career path
          </Button>
        </div>
      </Card>

      {!path ? (
        <Card>
          <EmptyState icon={<Route className="size-8" />} title="No career path yet" text="Your career timeline, estimated salaries and skills to build will appear here." />
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Career timeline" className="lg:col-span-2">
              <CareerTimeline />
              <p className="mt-4 text-xs text-slate-500">Salary ranges are estimates and vary by employer and market.</p>
            </Card>
            <Card className="flex flex-col items-center justify-center gap-4">
              <ScoreRing value={path.career_score} label="Career score" size={140} />
              <p className="text-center text-sm text-slate-600">{path.rationale}</p>
            </Card>
          </div>
          <Card title="Skills to build">
            <ul className="grid gap-4 md:grid-cols-2">
              {path.skills_to_build.map((s, i) => (
                <li key={i} className="rounded-xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">{s.skill}</div>
                  <p className="mt-1 text-sm text-slate-600">{s.why}</p>
                  {s.resource && (
                    <p className="mt-2 flex items-start gap-2 text-xs text-indigo-800">
                      <BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {s.resource}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  )
}
