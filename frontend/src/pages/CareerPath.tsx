import { ArrowUpRight, BookOpen, Route } from 'lucide-react'
import { MarketData } from '../components/MarketData'
import { ResourceFooter, ResourceList, useResources } from '../components/ResourceList'
import { ResumeSource } from '../components/Resume'
import { RoadmapView } from '../components/RoadmapView'
import {
  ActionHint,
  Badge,
  Button,
  Card,
  CareerTimeline,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  KeyNotice,
  PageHeader,
  ScoreRing,
  scoreBand,
  SkeletonCard,
} from '../components/ui'
import { FEATURED_ROADMAPS } from '../lib/roadmap'
import { api, CURRENCIES, useAction, useAiReady, type CareerPath, type Currency } from '../lib/api'
import { pushHistory, useCareerPath, useProfile, useResume, useStored } from '../lib/store'

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
  const key = useAiReady()
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

  const missing = !resume?.text ? 'Upload a resume to continue.' : !form.current_role.trim() ? 'Add your current role to continue.' : ''

  return (
    <>
      <PageHeader title="Career path" description="A realistic next step and longer-term direction, with the skills to build along the way." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Your situation" description="Based on your resume and where you want to go.">
            <div className="space-y-4">
              <ResumeSource />
              <Field label="Current role">
                <input className={inputCls} value={form.current_role} onChange={(e) => setForm({ ...form, current_role: e.target.value })} />
              </Field>
              <Field label="Target role" hint="Optional.">
                <input className={inputCls} value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value })} />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                <Field label="Location" hint="Optional. Improves salary estimates.">
                  <input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </Field>
                <Field label="Currency">
                  <select className={`${inputCls} t-num`} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <KeyNotice />
              <ErrorMessage message={action.error} />
              <Button variant="brand" icon={Route} onClick={run} loading={action.loading} disabled={!key || !!missing} className="w-full">
                {path ? 'Map again' : 'Map career path'}
              </Button>
              <ActionHint show={key && missing}>{missing}</ActionHint>
            </div>
          </Card>
          <Card title="Popular roadmaps" description="Pick one as your target, or open the official guide." className="mt-6">
            <ul className="space-y-3">
              {FEATURED_ROADMAPS.map((r) => (
                <li key={r.slug} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-title">{r.name}</p>
                      <p className="text-[13px] text-muted">{r.text}</p>
                    </div>
                    <a
                      href={`https://roadmap.sh/${r.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-faint hover:text-ink"
                      aria-label={`Open the ${r.name} roadmap on roadmap.sh`}
                      title="Open on roadmap.sh"
                    >
                      <ArrowUpRight className="size-4" strokeWidth={1.75} />
                    </a>
                  </div>
                  <Button
                    size="sm"
                    variant={form.target_role === r.role ? 'brand' : 'secondary'}
                    className="mt-2"
                    onClick={() => setForm({ ...form, target_role: r.role })}
                    aria-pressed={form.target_role === r.role}
                  >
                    {form.target_role === r.role ? 'Target set' : 'Use as target'}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {action.loading ? (
            <>
              <SkeletonCard lines={4} label="Mapping your career path" />
              <SkeletonCard lines={4} label="Finding skills to build" />
            </>
          ) : !path ? (
            <Card>
              <EmptyState
                icon={<Route strokeWidth={1.75} />}
                title="No career path yet"
                text="Your career timeline, salary estimates, market data and a personalised learning roadmap will appear here."
              />
            </Card>
          ) : (
            <Results path={path} location={form.location} currency={form.currency} />
          )}
        </div>
      </div>
    </>
  )
}

function Results({ path, location, currency }: { path: CareerPath; location: string; currency: Currency }) {
  const band = scoreBand(path.career_score)
  // One resolve call for the roadmap items and the skills to build.
  const resources = useResources('career', {
    ...Object.fromEntries((path.roadmap?.stages ?? []).flatMap((s) => s.items).map((it) => [`roadmap-${it.id}`, it.resource_queries])),
    ...Object.fromEntries(path.skills_to_build.map((s, i) => [`skill-${i}`, s.resource_queries])),
  })
  return (
    <>
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing value={path.career_score} label="Career score" size={112} showLabel={false} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-title">Career score</h2>
              <Badge tone={band.tone} dot>
                {band.label}
              </Badge>
            </div>
            <p className="text-sm text-muted">{path.rationale}</p>
          </div>
        </div>
      </Card>

      <Card title="Career timeline" description="AI salary ranges are estimates; market data comes from live sources where available.">
        <CareerTimeline path={path} extra={(title) => <MarketData title={title} location={location} currency={currency} />} />
      </Card>

      {path.roadmap && <RoadmapView roadmap={path.roadmap} resources={resources} />}

      <Card title="Skills to build" description="What closes the gap to your next role." padding={false}>
        {path.skills_to_build.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {path.skills_to_build.map((s, i) => (
              <li key={i} className="flex gap-4 px-5 py-4">
                <span className="t-num mt-px w-5 shrink-0 text-xs text-faint">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className="t-title">{s.skill}</div>
                  <p className="mt-1 text-[13px] leading-5 text-muted">{s.why}</p>
                  {s.resource && (
                    <p className="mt-2 flex items-start gap-2 text-[13px] leading-5 text-ink">
                      <BookOpen className="mt-0.5 size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
                      {s.resource}
                    </p>
                  )}
                  <ResourceList state={resources} id={`skill-${i}`} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-5 text-[13px] text-muted">None noted.</p>
        )}
        {path.skills_to_build.some((s) => s.resource_queries?.length) && (
          <div className="px-5 pb-4">
            <ResourceFooter state={resources} />
          </div>
        )}
      </Card>
    </>
  )
}
