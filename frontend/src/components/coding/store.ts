import type { CodingLanguage, CodingProblem, CodingReview } from '../../lib/api'
import { useStored } from '../../lib/store'

export interface ProblemProgress {
  attempted?: boolean
  solved?: boolean
  /** Time spent with the problem open, in milliseconds. */
  ms?: number
  lang?: CodingLanguage
  code?: Partial<Record<CodingLanguage, string>>
  hints?: number
  solutionShown?: boolean
  /** Reference solution check, run once when the problem is first opened. */
  ref?: { failing: number[]; unreliable: boolean }
  /** Last submit, as sent to the review endpoint. */
  last?: { lang: CodingLanguage; passed: number; total: number; failures: { args: string; expected: string; actual: string }[] }
  review?: CodingReview
}

export interface CodingSession {
  problems: CodingProblem[]
  progress: Record<string, ProblemProgress>
}

export const useCoding = () => useStored<CodingSession>('coding', { problems: [], progress: {} })

export function codingStats(session: CodingSession) {
  const ids = new Set(session.problems.map((p) => p.id))
  const list = Object.entries(session.progress).filter(([id]) => ids.has(id)).map(([, p]) => p)
  return { total: ids.size, attempted: list.filter((p) => p.attempted).length, solved: list.filter((p) => p.solved).length }
}
