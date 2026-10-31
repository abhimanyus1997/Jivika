import { serve, STDOUT_CAP } from './shared'

const format = (v: unknown) => {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

serve(() => null, (req, _runtime, post) => {
  if (req.lang !== 'javascript') throw new Error('Wrong runner.')
  let stdout = ''
  const write = (...args: unknown[]) => {
    if (stdout.length < STDOUT_CAP) stdout += args.map(format).join(' ').slice(0, STDOUT_CAP) + '\n'
  }
  const console = { log: write, info: write, warn: write, error: write, debug: write, table: write }
  Object.defineProperty(self, 'console', { value: console })

  let fn: unknown
  try {
    // ponytail: new Function in a throwaway worker is the sandbox; this file's CSP (main.py) allows it.
    fn = new Function(`"use strict";\n${req.code}\n;return typeof ${req.fn} === 'function' ? ${req.fn} : undefined`)()
  } catch (e) {
    throw new Error(e instanceof Error ? `${e.name}: ${e.message}` : String(e), { cause: e })
  }
  if (typeof fn !== 'function') throw new Error(`Define a function named ${req.fn}.`)

  req.tests.forEach((args, index) => {
    stdout = ''
    const start = performance.now()
    try {
      const result = (fn as (...a: unknown[]) => unknown)(...(JSON.parse(args) as unknown[]))
      const actual = result === undefined ? undefined : JSON.stringify(result)
      post({ type: 'test', index, actual, stdout, ms: performance.now() - start })
    } catch (e) {
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      post({ type: 'test', index, error, stdout, ms: performance.now() - start })
    }
  })
})
