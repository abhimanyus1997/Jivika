import type { CodingLanguage, CodingProblem } from '../../lib/api'
import type { RunMessage, RunRequest } from '../../workers/shared'

/** Execution limit once the runtime is ready. */
export const RUN_TIMEOUT_MS = 5000
/** Loading Pyodide: 10 s when it has loaded before (browser cache); the first download gets longer on slow links. */
const PY_LOAD_MS = 10_000
const PY_FIRST_LOAD_MS = 30_000
let pythonLoaded = false

// One fresh worker per run (Vite needs the literal new Worker(new URL(...)) form to bundle each one).
const spawn: Record<CodingLanguage, () => Worker> = {
  python: () => new Worker(new URL('../../workers/python.worker.ts', import.meta.url), { type: 'module' }),
  javascript: () => new Worker(new URL('../../workers/js.worker.ts', import.meta.url), { type: 'module' }),
  sql: () => new Worker(new URL('../../workers/sql.worker.ts', import.meta.url), { type: 'module' }),
}

// Each run gets a fresh worker. After a Python run a spare one starts loading Pyodide in the background, so
// the next run does not wait for it; it is still used for one run only.
let spare: Worker | null = null
const take = (lang: CodingLanguage) => {
  if (lang !== 'python' || !spare) return spawn[lang]()
  const w = spare
  spare = null
  return w
}
/** Stops the spare Python worker (call when leaving the playground). */
export function releaseSpare() {
  spare?.terminate()
  spare = null
}

export interface TestRun {
  index: number
  actual?: string
  error?: string
  stdout: string
  ms: number
}

export interface RunOutcome {
  tests: TestRun[]
  rows?: { columns: string[]; rows: unknown[][]; ms: number }
  error?: string
  /** 'load' when the runtime did not start in time, 'run' when the code did not finish. */
  timedOut?: 'load' | 'run'
}

/** Runs code in a new worker, which is terminated when it finishes or times out. */
export function execute(req: RunRequest, onPhase?: (phase: 'loading' | 'running') => void): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const worker = take(req.lang)
    const out: RunOutcome = { tests: [] }
    let timer = 0
    const finish = (extra: Partial<RunOutcome> = {}) => {
      clearTimeout(timer)
      worker.terminate()
      if (req.lang === 'python' && pythonLoaded && !spare) spare = spawn.python()
      resolve({ ...out, ...extra })
    }
    const arm = (ms: number, phase: 'load' | 'run') => {
      clearTimeout(timer)
      timer = window.setTimeout(() => finish({ timedOut: phase }), ms)
    }
    if (req.lang === 'python') {
      onPhase?.('loading')
      arm(pythonLoaded ? PY_LOAD_MS : PY_FIRST_LOAD_MS, 'load')
    } else arm(RUN_TIMEOUT_MS + 2000, 'load') // sql.js and the JS runner start in well under a second
    worker.onmessage = ({ data: m }: MessageEvent<RunMessage>) => {
      if (m.type === 'ready') {
        if (req.lang === 'python') pythonLoaded = true
        onPhase?.('running')
        arm(RUN_TIMEOUT_MS, 'run')
      } else if (m.type === 'test') out.tests[m.index] = m
      else if (m.type === 'rows') out.rows = m
      else if (m.type === 'error') finish({ error: m.error })
      else if (m.type === 'done') finish()
    }
    worker.onerror = (e) => {
      e.preventDefault()
      finish({ error: e.message || 'The code runner could not start.' })
    }
    worker.postMessage(req)
  })
}

/* ---------- Comparing results ---------- */

const TOLERANCE = 1e-6

/** Deep equality for JSON values; numbers match within 1e-6 (relative for large values). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => k in b && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const parse = (json: string | undefined): unknown => {
  if (json === undefined) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

/** SQLite has no booleans: expected true/false compares as 1/0. */
const sqlValue = (v: unknown) => (typeof v === 'boolean' ? Number(v) : v)
// Rounded so rows that differ only by float noise sort the same way.
const sortKey = (row: unknown[]) => JSON.stringify(row.map((v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)))
const byKey = (x: unknown[], y: unknown[]) => (sortKey(x) < sortKey(y) ? -1 : sortKey(x) > sortKey(y) ? 1 : 0)

/** Query rows against expected rows; order-insensitive unless orderMatters. */
export function rowsMatch(actual: unknown[][], expected: unknown[][], orderMatters: boolean): boolean {
  const norm = (rows: unknown[][]) => rows.map((r) => (Array.isArray(r) ? r.map(sqlValue) : [sqlValue(r)]))
  const a = norm(actual)
  const e = norm(expected)
  return orderMatters ? deepEqual(a, e) : deepEqual(a.sort(byKey), e.sort(byKey))
}

/* ---------- Grading a run against a problem ---------- */

export interface TestResult {
  index: number
  args: string
  expected: string
  actual: string
  pass: boolean
  error?: string
  stdout: string
  ms?: number
  /** The reference solution failed this test, so it is not scored. */
  excluded: boolean
}

export interface Graded {
  results: TestResult[]
  passed: number
  total: number
  error?: string
  timedOut?: 'load' | 'run'
  rows?: RunOutcome['rows']
}

const shown = (t: TestRun | undefined) => (!t || t.error ? '' : (t.actual ?? 'undefined'))

/** Function problems: compares each test; tests the reference solution fails are shown but not scored. */
export function grade(problem: CodingProblem, indices: number[], out: RunOutcome, excluded: number[] = []): Graded {
  const results = indices.map((index): TestResult => {
    const test = problem.tests[index]
    const run = out.tests[index]
    const pass = !!run && !run.error && run.actual !== undefined && deepEqual(parse(run.actual), parse(test.expected))
    const error = run?.error ?? (run ? undefined : out.timedOut ? 'Not run: time limit reached.' : 'Not run.')
    return {
      index,
      args: test.args,
      expected: test.expected,
      actual: shown(run),
      pass,
      error,
      stdout: run?.stdout ?? '',
      ms: run?.ms,
      excluded: excluded.includes(index),
    }
  })
  const scored = results.filter((r) => !r.excluded)
  return { results, passed: scored.filter((r) => r.pass).length, total: scored.length, error: out.error, timedOut: out.timedOut }
}

/** SQL problems: one check, the query's rows against the expected rows. */
export function gradeSql(problem: CodingProblem, out: RunOutcome): Graded {
  const expected = (parse(problem.sql?.expected_rows) as unknown[][] | undefined) ?? []
  const pass = !!out.rows && !out.error && rowsMatch(out.rows.rows, expected, !!problem.sql?.order_matters)
  const result: TestResult = {
    index: 0,
    args: 'Your query on the problem tables',
    expected: JSON.stringify(expected),
    actual: out.rows ? JSON.stringify(out.rows.rows) : '',
    pass,
    error: out.error ?? (out.timedOut ? 'Not run: time limit reached.' : undefined),
    stdout: '',
    ms: out.rows?.ms,
    excluded: false,
  }
  return { results: [result], passed: pass ? 1 : 0, total: 1, error: out.error, timedOut: out.timedOut, rows: out.rows }
}

/** Builds the worker request and grades the outcome. `indices` picks the tests (function problems only). */
export async function runProblem(
  problem: CodingProblem,
  lang: CodingLanguage,
  code: string,
  indices: number[],
  excluded: number[] = [],
  onPhase?: (phase: 'loading' | 'running') => void,
): Promise<Graded> {
  if (lang === 'sql') return gradeSql(problem, await execute({ lang, code, setup: problem.sql?.setup ?? '' }, onPhase))
  const fn = (lang === 'python' ? problem.function_names.python : problem.function_names.javascript) || problem.function_name
  const out = await execute({ lang, code, fn, tests: indices.map((i) => problem.tests[i].args) }, onPhase)
  // The worker numbers tests 0..n-1 in request order; map them back to the problem's test indices.
  const remapped: RunOutcome = { ...out, tests: [] }
  out.tests.forEach((t, i) => {
    if (t) remapped.tests[indices[i]] = { ...t, index: indices[i] }
  })
  return grade(problem, indices, remapped, excluded)
}

/** Runs the reference solution on every test; returns the tests it fails. */
export async function checkReference(problem: CodingProblem): Promise<{ failing: number[]; unreliable: boolean }> {
  const { language, code } = problem.solution
  const g = await runProblem(problem, language, code, problem.tests.map((_, i) => i))
  const failing = g.results.filter((r) => !r.pass).map((r) => r.index)
  return { failing, unreliable: failing.length > 0 || g.passed < g.total || !!g.error || !!g.timedOut }
}
