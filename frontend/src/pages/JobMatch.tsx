import { BookmarkPlus, Briefcase, Check, ChevronRight, ListPlus, MapPin, Route, Target } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ResumeSource } from '../components/Resume'
import { BulletList, Button, Card, Chip, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ActionHint, ProgressBar } from '../components/ui'
import { api, useAction, type MatchResult } from '../lib/api'
import { newId, today, useApiKey, useApplications, useJobDescription, useLastMatch, useLastMatchJd, useMatches, useResume } from '../lib/store'

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-slate-200">
      <summary className="flex list-none items-center justify-between px-4 py-3 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRight className="size-4 text-slate-500 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-4 py-4">{children}</div>
    </details>
  )
}

function ChipList({ items, tone, empty }: { items: string[]; tone: 'emerald' | 'rose'; empty: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Chip key={s} tone={tone}>
          {s}
        </Chip>
      ))}
    </div>
  )
}

function MatchCard({ result: r, jd }: { result: MatchResult; jd: string }) {
  const [showPlan, setShowPlan] = useState(false)
  const [matches, setMatches] = useMatches()
  const [, setApplications] = useApplications()
  const savedId = matches.find((m) => m.job_description === jd && m.result.job_title === r.job_title)?.id

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
          <Briefcase className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-900">{r.job_title || 'Untitled role'}</h2>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
            <span>{r.company || 'Company not stated'}</span>
            {r.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {r.location}
              </span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.experience_required && <Chip>{r.experience_required}</Chip>}
            {r.employment_type && <Chip>{r.employment_type}</Chip>}
            <Chip tone={r.salary_range ? 'emerald' : 'slate'}>{r.salary_range || 'Salary not stated'}</Chip>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!!savedId}
            onClick={() => setMatches((m) => [...m, { id: newId(), savedAt: new Date().toISOString(), job_description: jd, result: r }])}
          >
            {savedId ? <Check className="size-4" aria-hidden="true" /> : <BookmarkPlus className="size-4" aria-hidden="true" />}
            {savedId ? 'Saved' : 'Save to Top Picks'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setApplications((a) => [
                { id: newId(), company: r.company, role: r.job_title, date: today(), status: 'Applied', link: '', notes: '' },
                ...a,
              ])
              location.hash = 'applications'
            }}
          >
            <ListPlus className="size-4" aria-hidden="true" />
            Track application
          </Button>
        </div>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-slate-700">{r.summary}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <ProgressBar value={r.match_score} label="Match score" />
        <ProgressBar value={r.keyword_coverage} label="Keyword coverage" />
      </div>

      <div className="mt-6 space-y-3">
        <Section title="Skills" open>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Matched ({r.matched_skills.length})</h3>
              <ChipList items={r.matched_skills} tone="emerald" empty="No matching skills found." />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Missing ({r.missing_skills.length})</h3>
              <ChipList items={r.missing_skills} tone="rose" empty="No missing skills found." />
            </div>
          </div>
        </Section>
        <Section title="Strengths and Gaps">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Strengths</h3>
              <BulletList items={r.strengths} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Gaps</h3>
              <BulletList items={r.gaps} />
            </div>
          </div>
        </Section>
        <Section title="Market Insights">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Challenges</h3>
              <BulletList items={r.challenges} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-700">Opportunities</h3>
              <BulletList items={r.opportunities} />
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6">
        {!showPlan ? (
          <Button onClick={() => setShowPlan(true)} disabled={!r.transition_plan.length}>
            <Route className="size-4" aria-hidden="true" />
            Create Transition Plan
          </Button>
        ) : (
          <div>
            <h3 className="mb-3 font-semibold text-slate-900">Transition plan</h3>
            <ol className="space-y-3">
              {r.transition_plan.map((s, i) => (
                <li key={i} className="flex gap-3 rounded-xl bg-slate-50 p-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{s.step}</span>
                      {s.timeframe && <Chip tone="indigo">{s.timeframe}</Chip>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function JobMatch() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [result, setResult] = useLastMatch()
  const [resultJd, setResultJd] = useLastMatchJd()
  const key = useApiKey()
  const match = useAction(api.match)

  async function analyze() {
    if (!resume?.text) return
    const r = await match.run(resume.text, jd)
    if (r) {
      setResult(r)
      setResultJd(jd)
    }
  }

  return (
    <>
      <PageIntro>Paste a job description to see how well your resume fits, what is missing, and how to close the gap.</PageIntro>
      <Card>
        <div className="space-y-4">
          <ResumeSource />
          <Field label="Job description">
            <textarea
              className={`${inputCls} h-48`}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the full job description here."
            />
          </Field>
          <KeyNotice />
          <ErrorMessage message={match.error} />
          <Button onClick={analyze} loading={match.loading} disabled={!key || !resume?.text || jd.trim().length < 30}>
            <Target className="size-4" aria-hidden="true" />
            Analyze match
          </Button>
          <ActionHint show={key && resume?.text && jd.trim().length < 30}>Paste at least a few lines of the job description to continue.</ActionHint>
        </div>
      </Card>

      {result ? (
        <MatchCard result={result} jd={resultJd} />
      ) : (
        <Card>
          <EmptyState
            icon={<Target className="size-8" />}
            title="No match yet"
            text="Your match score, skills analysis and transition plan will appear here."
          />
        </Card>
      )}
    </>
  )
}
