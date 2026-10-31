import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  CodeXml,
  Eye,
  Lightbulb,
  LoaderCircle,
  Play,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, useAction, useAiReady, type CodingLanguage, type CodingProblem } from '../../lib/api'
import { useStored } from '../../lib/store'
import { ResourceFooter, ResourceList, useResources } from '../ResourceList'
import {
  ActionHint,
  Badge,
  BulletList,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  Modal,
  ScoreRing,
  scoreBand,
  Segmented,
  SkeletonCard,
  type BadgeTone,
} from '../ui'
import { RUN_TIMEOUT_MS, checkReference, releaseSpare, runProblem, type Graded } from './run'
import { useCoding, codingStats, type ProblemProgress } from './store'

const LANG_LABEL: Record<CodingLanguage, string> = { python: 'Python', javascript: 'JavaScript', sql: 'SQL' }
const ALL_LANGS: CodingLanguage[] = ['python', 'javascript', 'sql']
const DIFFICULTY_TONE: Record<CodingProblem['difficulty'], BadgeTone> = { easy: 'brand', medium: 'warning', hard: 'danger' }
const RUN_TESTS = 3 // Run checks the first few tests; Submit checks all of them
const DRAFTS = 'coding.draft.'

// CodeMirror loads with the first opened problem, not with the app.
const CodeEditor = lazy(() => import('./Editor'))

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function formatTime(ms = 0) {
  const min = Math.round(ms / 60000)
  return min < 1 ? 'Under a minute' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

function useProgress(id: string): [ProblemProgress, (patch: Partial<ProblemProgress> | ((p: ProblemProgress) => Partial<ProblemProgress>)) => void] {
  const [session, setSession] = useCoding()
  const progress = session.progress[id] ?? {}
  const update = (patch: Partial<ProblemProgress> | ((p: ProblemProgress) => Partial<ProblemProgress>)) =>
    setSession((s) => {
      const prev = s.progress[id] ?? {}
      return { ...s, progress: { ...s.progress, [id]: { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) } } }
    })
  return [progress, update]
}

/* ---------- Setup (count and languages) ---------- */

type GenerateAction = ReturnType<typeof useAction<[Parameters<typeof api.codingProblems>[0]], { problems: CodingProblem[] }>>

/** `action` is useAction(api.codingProblems), owned by the page so the problem list can show its loading state. */
export function CodingSetup({ resume, jd, action }: { resume: string; jd: string; action: GenerateAction }) {
  const [session, setSession] = useCoding()
  const [count, setCount] = useState(4)
  const [langs, setLangs] = useState<CodingLanguage[]>(ALL_LANGS)
  const key = useAiReady()

  async function generate() {
    const r = await action.run({ resume, job_description: jd, count, languages: langs })
    if (!r) return
    // Drafts and practice links belong to the old problem set.
    for (const k of Object.keys(localStorage))
      if (k.startsWith(`jivika.${DRAFTS}`) || k.startsWith('jivika.resources.coding-')) localStorage.removeItem(k)
    setSession({ problems: r.problems, progress: {} })
  }

  return (
    <div className="space-y-4">
      <Field label="Number of problems" hint="Between 3 and 6.">
        <input
          type="number"
          min={3}
          max={6}
          className={`${inputCls} t-num max-w-24`}
          value={count}
          onChange={(e) => setCount(Math.min(6, Math.max(3, Number(e.target.value) || 3)))}
        />
      </Field>
      <fieldset>
        <legend className="t-label mb-1.5">Languages</legend>
        <div className="flex flex-wrap gap-2">
          {ALL_LANGS.map((l) => {
            const on = langs.includes(l)
            return (
              <label
                key={l}
                className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${
                  on ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted hover:border-line-strong'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => setLangs((cur) => (on ? cur.filter((x) => x !== l) : ALL_LANGS.filter((x) => x === l || cur.includes(x))))}
                />
                {on ? <CircleCheck className="size-3.5" strokeWidth={2} aria-hidden="true" /> : <span className="size-3.5 rounded-full border border-line-strong" aria-hidden="true" />}
                {LANG_LABEL[l]}
              </label>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs leading-4 text-faint">Data roles get SQL and data problems; software roles get algorithm problems.</p>
      </fieldset>
      <ErrorMessage message={action.error} />
      <Button
        variant="brand"
        icon={CodeXml}
        className="w-full"
        onClick={generate}
        loading={action.loading}
        disabled={!key || !resume || jd.trim().length < 30 || !langs.length}
      >
        {session.problems.length ? 'Generate new problems' : 'Generate problems'}
      </Button>
      <ActionHint show={key && resume && jd.trim().length < 30}>Paste at least a few lines of the job description to continue.</ActionHint>
      <ActionHint show={!langs.length}>Choose at least one language.</ActionHint>
      <ActionHint show={session.problems.length && !action.loading}>Generating new problems replaces the current set and its progress.</ActionHint>
    </div>
  )
}

/* ---------- Problem list ---------- */

function StatusBadge({ p }: { p?: ProblemProgress }) {
  if (p?.solved) return <Badge tone="brand" dot>Solved</Badge>
  if (p?.attempted) return <Badge tone="warning" dot>Attempted</Badge>
  return <Badge dot>Not started</Badge>
}

export function ProblemList({ loading, onOpen }: { loading: boolean; onOpen: (id: string) => void }) {
  const [session] = useCoding()
  const stats = codingStats(session)
  if (loading)
    return (
      <>
        <SkeletonCard lines={2} label="Generating problems" />
        <SkeletonCard lines={2} label="Generating problems" />
      </>
    )
  if (!session.problems.length)
    return (
      <Card>
        <EmptyState
          icon={<CodeXml strokeWidth={1.75} />}
          title="No coding problems yet"
          text="Add your resume and the job description, then generate problems. Your code runs in this browser, not on our servers."
        />
      </Card>
    )
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="t-title">Problems</h2>
        <span className="t-num text-[13px] text-muted">
          {stats.solved} of {stats.total} solved
        </span>
      </div>
      <Card padding={false}>
        <ul className="divide-y divide-line">
          {session.problems.map((p, i) => {
            const prog = session.progress[p.id]
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl hover:bg-subtle/60"
                >
                  <span className="t-num mt-0.5 w-7 shrink-0 text-[13px] text-faint">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="t-title leading-6">{p.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={DIFFICULTY_TONE[p.difficulty]}>{cap(p.difficulty)}</Badge>
                      {p.topic && <span className="text-[13px] text-muted">{p.topic}</span>}
                      <span className="text-xs text-faint">{p.languages.map((l) => LANG_LABEL[l]).join(' · ')}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge p={prog} />
                    {!!prog?.ms && <span className="t-num text-xs text-faint">{formatTime(prog.ms)}</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}

/* ---------- Problem view ---------- */

function Mono({ children, label }: { children: string; label?: string }) {
  return (
    <div>
      {label && <div className="t-overline mb-1">{label}</div>}
      <pre className="overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[12.5px] leading-5 whitespace-pre-wrap break-words text-ink">
        {children}
      </pre>
    </div>
  )
}

function Statement({ problem, progress, update }: { problem: CodingProblem; progress: ProblemProgress; update: ReturnType<typeof useProgress>[1] }) {
  const [confirm, setConfirm] = useState(false)
  const hints = progress.hints ?? 0
  const resources = useResources(`coding-${problem.id}`, { practice: problem.practice_queries })
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {problem.statement.split(/\n\s*\n/).map((para, i) => (
          <p key={i} className="text-sm leading-6 whitespace-pre-line text-ink">
            {para}
          </p>
        ))}
      </div>

      {!!problem.examples.length && (
        <div className="space-y-3">
          <h3 className="t-overline">Examples</h3>
          {problem.examples.map((ex, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line p-3">
              <div className="t-label">Example {i + 1}</div>
              <Mono label="Input">{ex.input}</Mono>
              <Mono label="Output">{ex.output}</Mono>
              {ex.explanation && <p className="text-[13px] leading-5 text-muted">{ex.explanation}</p>}
            </div>
          ))}
        </div>
      )}

      {problem.sql && (
        <details className="rounded-lg border border-line">
          <summary className="px-3 py-2 text-[13px] font-medium text-ink">Tables and sample data</summary>
          <div className="border-t border-line p-3">
            <Mono>{problem.sql.setup}</Mono>
          </div>
        </details>
      )}

      {!!problem.constraints.length && (
        <div>
          <h3 className="t-overline mb-2">Constraints</h3>
          <BulletList items={problem.constraints} />
        </div>
      )}

      {!!problem.hints.length && (
        <div>
          <h3 className="t-overline mb-2">Hints</h3>
          <ol className="space-y-2">
            {problem.hints.slice(0, hints).map((h, i) => (
              <li key={i} className="flex gap-2 rounded-lg border border-accent-100 bg-accent-50 px-3 py-2 text-[13px] leading-5 text-ink">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent-700" strokeWidth={1.75} aria-hidden="true" />
                <span>
                  <span className="sr-only">Hint {i + 1}: </span>
                  {h}
                </span>
              </li>
            ))}
          </ol>
          {hints < problem.hints.length && (
            <Button variant="secondary" size="sm" icon={Lightbulb} className={hints ? 'mt-2' : ''} onClick={() => update({ hints: hints + 1 })}>
              {hints ? 'Show next hint' : 'Show a hint'} ({hints + 1} of {problem.hints.length})
            </Button>
          )}
        </div>
      )}

      <div>
        <h3 className="t-overline mb-2">Solution</h3>
        {progress.solutionShown ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-muted">Reference solution in {LANG_LABEL[problem.solution.language]}</span>
              <CopyButton text={problem.solution.code} label="Copy" />
            </div>
            <Mono>{problem.solution.code}</Mono>
          </div>
        ) : (
          <Button variant="secondary" size="sm" icon={Eye} onClick={() => setConfirm(true)}>
            Show solution
          </Button>
        )}
      </div>

      {resources.asked.size > 0 && (
        <div className="space-y-3">
          <ResourceList state={resources} id="practice" className="" />
          <ResourceFooter state={resources} />
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Show the solution?"
        description="Trying the problem first is the best practice. You can still submit afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep trying
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                update({ solutionShown: true })
                setConfirm(false)
              }}
            >
              Show solution
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">The reference solution was written by the model and checked against the tests in your browser.</p>
      </Modal>
    </div>
  )
}

function Results({ graded, mode, lang }: { graded: Graded; mode: 'run' | 'submit'; lang: CodingLanguage }) {
  const all = graded.total > 0 && graded.passed === graded.total
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="t-title">{mode === 'submit' ? 'Submission' : 'Run'}</h3>
        <Badge tone={all ? 'brand' : 'danger'} mono>
          {lang === 'sql' ? (all ? 'Rows match' : 'Rows differ') : `${graded.passed}/${graded.total} tests passed`}
        </Badge>
        {graded.results.some((r) => r.excluded) && <span className="text-xs text-faint">Tests the reference solution fails are not counted.</span>}
      </div>
      {graded.timedOut === 'run' && (
        <ErrorMessage message={`Stopped after ${RUN_TIMEOUT_MS / 1000} s: the code did not finish in time. Check for an infinite loop or a slow approach.`} />
      )}
      {graded.timedOut === 'load' && <ErrorMessage message="The code runner did not start in time. Check your connection and try again." />}
      {graded.error && <ErrorMessage message={graded.error} />}

      {graded.rows && (
        <div className="table-wrap max-h-72">
          <table className="data-table">
            <thead>
              <tr>
                {graded.rows.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {graded.rows.rows.slice(0, 100).map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => (
                    <td key={j} className="font-mono text-[12.5px]">
                      {v === null ? <span className="text-faint">NULL</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
              {!graded.rows.rows.length && (
                <tr>
                  <td className="text-muted" colSpan={Math.max(1, graded.rows.columns.length)}>
                    The query returned no rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ul className="space-y-2">
        {graded.results.map((r) => (
          <li key={r.index}>
            <details className="group rounded-lg border border-line bg-surface" open={!r.pass && !r.excluded}>
              <summary className="flex list-none items-center gap-2 px-3 py-2 text-[13px] [&::-webkit-details-marker]:hidden">
                {r.pass ? (
                  <CircleCheck className="size-4 text-brand-600" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <CircleX className="size-4 text-danger" strokeWidth={1.75} aria-hidden="true" />
                )}
                <span className="font-medium text-ink">{lang === 'sql' ? 'Expected rows' : `Test ${r.index + 1}`}</span>
                <span className={r.pass ? 'text-brand-700' : 'text-danger'}>{r.pass ? 'Passed' : 'Failed'}</span>
                {r.excluded && <Badge tone="warning">Not counted</Badge>}
                {r.ms !== undefined && <span className="t-num ml-auto text-xs text-faint">{r.ms < 1 ? '<1' : Math.round(r.ms)} ms</span>}
              </summary>
              <div className="space-y-2 border-t border-line p-3">
                {lang !== 'sql' && <Mono label="Arguments">{r.args}</Mono>}
                <Mono label={lang === 'sql' ? 'Expected rows' : 'Expected'}>{r.expected}</Mono>
                {r.error ? <Mono label="Error">{r.error}</Mono> : <Mono label={lang === 'sql' ? 'Your rows' : 'Returned'}>{r.actual || '(nothing)'}</Mono>}
                {r.stdout && <Mono label="Output">{r.stdout}</Mono>}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Review({ problem, progress, update, code, lang }: { problem: CodingProblem; progress: ProblemProgress; update: ReturnType<typeof useProgress>[1]; code: string; lang: CodingLanguage }) {
  const key = useAiReady()
  const action = useAction(api.codingReview)
  const last = progress.last
  const review = progress.review
  const band = review ? scoreBand(review.score) : null

  async function run() {
    if (!last) return
    const r = await action.run({
      title: problem.title.slice(0, 200),
      statement: problem.statement,
      language: lang,
      code: code.slice(0, 20000),
      results: { passed: last.passed, total: last.total, failures: last.failures },
    })
    if (r) update({ review: r })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={Sparkles} onClick={run} loading={action.loading} disabled={!key || !last || last.lang !== lang || !code.trim()}>
          {review ? 'Get a new AI review' : 'Get AI review'}
        </Button>
        <ActionHint show={!last || last.lang !== lang}>Submit your {LANG_LABEL[lang]} code first; the review uses the test results.</ActionHint>
      </div>
      <ErrorMessage message={action.error} />
      {action.loading && <SkeletonCard lines={3} label="Loading review" />}
      {review && !action.loading && (
        <div className="space-y-5 rounded-lg border border-line bg-canvas p-4">
          <div className="flex items-center gap-4">
            <ScoreRing value={review.score} label="Review score" size={64} showLabel={false} />
            <div className="min-w-0">
              <div className="t-title">AI review</div>
              <p className={`text-[13px] font-medium ${band?.text}`}>{band?.label}</p>
              {review.verdict && <p className="mt-1 text-[13px] leading-5 text-muted">{review.verdict}</p>}
            </div>
          </div>
          {review.correctness && (
            <div>
              <div className="t-overline mb-1">Correctness</div>
              <p className="text-[13px] leading-5 text-ink">{review.correctness}</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="t-overline mb-1">Time complexity</div>
              <div className="t-num text-[13px] text-ink">{review.complexity.time || 'Not stated'}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="t-overline mb-1">Space complexity</div>
              <div className="t-num text-[13px] text-ink">{review.complexity.space || 'Not stated'}</div>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="t-overline mb-2">Edge cases</div>
              <BulletList items={review.edge_cases} />
            </div>
            <div>
              <div className="t-overline mb-2">Code quality</div>
              <BulletList items={review.code_quality} />
            </div>
          </div>
          {review.improved_code && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="t-overline">Improved code</div>
                <CopyButton text={review.improved_code} label="Copy" />
              </div>
              <Mono>{review.improved_code}</Mono>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ProblemView({ problem, onBack }: { problem: CodingProblem; onBack: () => void }) {
  const [progress, update] = useProgress(problem.id)
  const [drafts, setDrafts] = useStored<Partial<Record<CodingLanguage, string>>>(DRAFTS + problem.id, {})
  const lang: CodingLanguage = progress.lang && problem.languages.includes(progress.lang) ? progress.lang : problem.languages[0]
  const starter = problem.starter[lang] ?? ''
  const code = drafts[lang] ?? starter
  const [busy, setBusy] = useState<'' | 'loading' | 'running'>('')
  const [graded, setGraded] = useState<{ mode: 'run' | 'submit'; lang: CodingLanguage; g: Graded } | null>(null)
  const [checking, setChecking] = useState(false)

  // Time spent: added when the problem is closed or the page hides.
  const opened = useRef(Date.now())
  useEffect(() => {
    opened.current = Date.now()
    const flush = () => {
      const ms = Date.now() - opened.current
      opened.current = Date.now()
      if (ms > 1000) update((p) => ({ ms: (p.ms ?? 0) + ms }))
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
      releaseSpare()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per problem
  }, [problem.id])

  // Check the model's reference solution once, silently, so unreliable tests are flagged and not scored.
  const ref = progress.ref
  useEffect(() => {
    if (ref) return
    let live = true
    setChecking(true)
    checkReference(problem).then((r) => {
      if (!live) return
      setChecking(false)
      update({ ref: r })
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per problem
  }, [problem.id, !!ref])
  // Exclude the reference's failures, unless it failed everything (then nothing would be scored).
  const excluded = ref && ref.failing.length < problem.tests.length ? ref.failing : []

  async function run(mode: 'run' | 'submit') {
    const all = problem.tests.map((_, i) => i)
    const indices = mode === 'run' ? all.slice(0, RUN_TESTS) : all
    setBusy(lang === 'python' ? 'loading' : 'running')
    setGraded(null)
    const g = await runProblem(problem, lang, code, indices, excluded, setBusy)
    setBusy('')
    setGraded({ mode, lang, g })
    if (mode === 'submit') {
      const failures = g.results
        .filter((r) => !r.pass && !r.excluded)
        .slice(0, 5)
        .map((r) => ({ args: r.args.slice(0, 2000), expected: r.expected.slice(0, 2000), actual: (r.error || r.actual).slice(0, 2000) }))
      update((p) => ({
        attempted: true,
        solved: p.solved || (g.total > 0 && g.passed === g.total),
        last: { lang, passed: g.passed, total: g.total, failures },
      }))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          All problems
        </Button>
        <StatusBadge p={progress} />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card
          title={<span className="text-base">{problem.title}</span>}
          description={
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={DIFFICULTY_TONE[problem.difficulty]}>{cap(problem.difficulty)}</Badge>
              {problem.topic && <span>{problem.topic}</span>}
            </span>
          }
          className="xl:sticky xl:top-[76px] xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto"
        >
          {ref?.unreliable && (
            <div className="mb-4 flex gap-2 rounded-lg border border-accent-100 bg-warning-bg px-3 py-2 text-[13px] leading-5 text-warning" role="note">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span>
                <span className="font-medium">Tests may be unreliable.</span>{' '}
                {excluded.length
                  ? `The reference solution fails ${excluded.length} of ${problem.tests.length} tests, so those are not counted.`
                  : 'The reference solution did not pass its own checks, so treat the results as a guide.'}
              </span>
            </div>
          )}
          <Statement problem={problem} progress={progress} update={update} />
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {problem.languages.length > 1 ? (
                  <Segmented
                    label="Language"
                    size="sm"
                    options={problem.languages.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
                    value={lang}
                    onChange={(l) => {
                      update({ lang: l })
                      setGraded(null)
                    }}
                  />
                ) : (
                  <Badge>{LANG_LABEL[lang]}</Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  disabled={code === starter}
                  onClick={() => setDrafts((d) => ({ ...d, [lang]: undefined }))}
                >
                  Reset code
                </Button>
              </div>
              <Suspense fallback={<div className="h-[min(60vh,520px)] min-h-72 animate-pulse rounded-lg border border-line bg-subtle" role="status" aria-label="Loading the editor" />}>
              <CodeEditor
                key={problem.id}
                value={code}
                lang={lang}
                label={`${LANG_LABEL[lang]} code editor`}
                onChange={(v) => setDrafts((d) => ({ ...d, [lang]: v }))}
                onRun={() => !busy && run('run')}
              />
              </Suspense>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" icon={Play} onClick={() => run('run')} disabled={!!busy || !code.trim()}>
                  Run
                </Button>
                <Button variant="brand" icon={SendHorizontal} onClick={() => run('submit')} disabled={!!busy || !code.trim()}>
                  Submit
                </Button>
                <span className="text-xs leading-4 text-faint" role="status">
                  {busy === 'loading' ? (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                      Loading Python runtime (first run downloads about 12 MB)
                    </span>
                  ) : busy === 'running' ? (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                      Running
                    </span>
                  ) : checking ? (
                    'Checking the tests'
                  ) : lang === 'sql' ? (
                    'Run and Submit compare your rows with the expected rows.'
                  ) : (
                    `Run checks the first ${Math.min(RUN_TESTS, problem.tests.length)} tests; Submit checks all ${problem.tests.length}. Ctrl+Enter runs.`
                  )}
                </span>
              </div>
            </div>
          </Card>

          {graded && (
            <Card>
              <Results graded={graded.g} mode={graded.mode} lang={graded.lang} />
            </Card>
          )}

          <Card title="AI review" description="Feedback on correctness, complexity and code quality, based on your last submission.">
            <Review problem={problem} progress={progress} update={update} code={code} lang={lang} />
          </Card>
        </div>
      </div>
    </div>
  )
}
