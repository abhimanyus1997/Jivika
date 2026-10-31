import { ExternalLink, FlaskConical, Timer } from 'lucide-react'
import type { Roadmap, RoadmapStatus } from '../lib/api'
import { ROADMAP_ATTRIBUTION } from '../lib/roadmap'
import { roadmapProgress, useRoadmapDone } from '../lib/store'
import { ResourceFooter, ResourceList, type ResourcesState } from './ResourceList'
import { Badge, ButtonLink, Card, type BadgeTone } from './ui'

const STATUS: Record<RoadmapStatus, { label: string; tone: BadgeTone }> = {
  have: { label: 'Have', tone: 'brand' },
  next: { label: 'Learn next', tone: 'accent' },
  later: { label: 'Later', tone: 'neutral' },
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand-500 transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Interactive vertical roadmap: stages, item cards, done checkboxes and progress (stored in localStorage). */
export function RoadmapView({ roadmap, resources }: { roadmap: Roadmap; resources?: ResourcesState }) {
  const [done, setDone] = useRoadmapDone()
  const all = roadmap.stages.flatMap((s) => s.items)
  const overall = roadmapProgress(all, done)
  if (!all.length) return null

  return (
    <Card
      title={roadmap.title || 'Learning roadmap'}
      description="A plan written for your profile. Tick items off as you go; progress stays in this browser."
      action={
        roadmap.roadmap_sh && (
          <ButtonLink href={roadmap.roadmap_sh.url} target="_blank" rel="noopener noreferrer" size="sm" icon={ExternalLink}>
            See the full roadmap on roadmap.sh
          </ButtonLink>
        )
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink">Overall progress</span>
            <span className="t-num text-muted">
              {overall.done} of {overall.total} · {overall.pct}%
            </span>
          </div>
          <Bar pct={overall.pct} label="Overall roadmap progress" />
        </div>

        <ol className="ml-3 border-l border-line">
          {roadmap.stages.map((stage, si) => {
            const p = roadmapProgress(stage.items, done)
            return (
              <li key={`${si}-${stage.name}`} className="relative pb-6 pl-6 last:pb-0">
                <span
                  className={`t-num absolute top-0 -left-3 flex size-6 items-center justify-center rounded-full border text-[11px] font-medium ${
                    p.total && p.done === p.total ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface text-ink'
                  }`}
                  aria-hidden="true"
                >
                  {si + 1}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="t-title">{stage.name}</h3>
                  <span className="t-num text-xs text-muted">
                    {p.done}/{p.total} done
                  </span>
                </div>
                <div className="mt-1.5 mb-3 max-w-xs">
                  <Bar pct={p.pct} label={`${stage.name} progress`} />
                </div>
                <ul className="space-y-2">
                  {stage.items.map((item) => {
                    const checked = done[item.id] ?? item.status === 'have'
                    const s = STATUS[item.status] ?? STATUS.next
                    return (
                      <li key={item.id} className={`rounded-lg border border-line p-3 ${checked ? 'bg-canvas' : 'bg-surface'}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            id={`rm-${item.id}`}
                            className="mt-1 size-4 shrink-0 rounded border-line-strong accent-brand-600"
                            checked={checked}
                            onChange={(e) => setDone((d) => ({ ...d, [item.id]: e.target.checked }))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <label htmlFor={`rm-${item.id}`} className={`t-title cursor-pointer ${checked ? 'text-muted line-through decoration-line-strong' : ''}`}>
                                {item.skill}
                              </label>
                              <Badge tone={s.tone}>{s.label}</Badge>
                            </div>
                            {item.why && <p className="mt-1 text-[13px] leading-5 text-muted">{item.why}</p>}
                            {(item.project || item.estimate || item.roadmap_sh_url) && (
                              <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1 text-[13px] leading-5">
                                {item.project && (
                                  <span className="flex min-w-0 items-start gap-1.5 text-ink">
                                    <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
                                    <span>
                                      <span className="sr-only">Project: </span>
                                      {item.project}
                                    </span>
                                  </span>
                                )}
                                {item.estimate && (
                                  <span className="t-num flex items-center gap-1.5 text-muted">
                                    <Timer className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
                                    <span className="sr-only">Estimate: </span>
                                    {item.estimate}
                                  </span>
                                )}
                                {item.roadmap_sh_url && (
                                  <a
                                    href={item.roadmap_sh_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
                                  >
                                    roadmap.sh <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden="true" />
                                    <span className="sr-only">guide for {item.skill}</span>
                                  </a>
                                )}
                              </div>
                            )}
                            {resources && <ResourceList state={resources} id={`roadmap-${item.id}`} />}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
        {resources && <ResourceFooter state={resources} prefix="roadmap-" />}
        <p className="border-t border-line pt-3 text-xs text-faint">{ROADMAP_ATTRIBUTION}</p>
      </div>
    </Card>
  )
}
