import { CircleCheck, CircleDashed, CircleMinus, Plus } from 'lucide-react'
import type { RequirementItem, RequirementResult } from '../lib/store'
import { Badge, ButtonLink } from './ui'

const STATUS = {
  met: { icon: CircleCheck, label: 'Met', cls: 'text-brand-600' },
  partial: { icon: CircleMinus, label: 'Partly met', cls: 'text-accent-600' },
  missing: { icon: CircleDashed, label: 'Not in your profile', cls: 'text-faint' },
}

/** Short terms (a tool, a language) go to skills; longer ones read as experience. */
// ponytail: word-count heuristic, ask the server for a section hint if it misroutes often.
const profileSection = (text: string) => (text.trim().split(/\s+/).length <= 3 ? 'skills' : 'experience')

export const addToProfileHref = (r: RequirementItem) =>
  `#profile?${new URLSearchParams({ section: profileSection(r.text), add: r.text.slice(0, 80) })}`

/** 'x/y': requirements met out of all requirements. */
export const matchLabel = (s: RequirementResult['summary']) => `${s.met}/${s.total}`

/** Requirement checklist: each requirement with whether the profile shows it and where. */
export function RequirementMatch({ result, compact = false, onAdd }: { result: RequirementResult; compact?: boolean; /** Runs before '+ Add to profile' leaves the page. */ onAdd?: () => void }) {
  const { summary: s } = result
  const groups = (['required', 'preferred'] as const).map((kind) => ({ kind, items: result.requirements.filter((r) => r.kind === kind) })).filter((g) => g.items.length)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Badge tone={s.total && s.met / s.total >= 0.6 ? 'brand' : 'neutral'} mono>
          {matchLabel(s)} match
        </Badge>
        <span>
          {s.met} met, {s.partial} partly, {s.missing} not in your profile
        </span>
      </div>
      {groups.map((g) => (
        <section key={g.kind}>
          <h3 className="t-overline mb-2">{g.kind === 'required' ? 'Required' : 'Nice to have'}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {g.items.map((r) => {
              const st = STATUS[r.status] ?? STATUS.missing
              return (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <st.icon className={`mt-0.5 size-4 shrink-0 ${st.cls}`} strokeWidth={1.75} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">
                      {r.text}
                      <span className="sr-only">: {st.label}</span>
                    </p>
                    {!compact && r.evidence && <p className="text-xs leading-5 text-muted">{r.evidence}</p>}
                  </div>
                  {r.status === 'missing' && (
                    <ButtonLink href={addToProfileHref(r)} onClick={onAdd} size="sm" variant="ghost" icon={Plus} aria-label={`Add ${r.text} to profile`}>
                      Add to profile
                    </ButtonLink>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {!result.requirements.length && <p className="text-[13px] text-muted">No requirements were found in this posting.</p>}
    </div>
  )
}
