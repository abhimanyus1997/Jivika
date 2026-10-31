/**
 * Shared by the playground workers. Each run gets a fresh worker that the page terminates afterwards.
 * Code here runs model-written reference solutions and the user's code, so before running anything the
 * worker drops network and storage APIs and keeps its own private handle to postMessage (so the code under
 * test cannot post fake results).
 */
export type RunRequest =
  | { lang: 'python' | 'javascript'; code: string; fn: string; tests: string[] }
  | { lang: 'sql'; code: string; setup: string }

export type RunMessage =
  | { type: 'ready' }
  | { type: 'test'; index: number; actual?: string; error?: string; stdout: string; ms: number }
  | { type: 'rows'; columns: string[]; rows: unknown[][]; ms: number }
  | { type: 'error'; error: string }
  | { type: 'done' }

export const STDOUT_CAP = 8000

interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

const LOCKED = ['postMessage', 'onmessage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'BroadcastChannel', 'WebTransport']

/**
 * `prepare` loads the runtime as soon as the worker starts (it may fetch), so a spare worker can warm up
 * before it is needed. Then the scope is locked down, and the single run request is handled by `run`.
 * Errors become one 'error' message; otherwise 'done' follows.
 */
export function serve<T>(prepare: () => Promise<T> | T, run: (req: RunRequest, runtime: T, post: (m: RunMessage) => void) => void) {
  const scope = self as unknown as WorkerScope
  const post = scope.postMessage.bind(scope) as (m: RunMessage) => void
  const runtime = Promise.resolve()
    .then(prepare)
    .then((rt) => {
      for (const name of LOCKED) {
        try {
          Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false })
        } catch {
          // ponytail: best effort; the CSP still limits connections to this origin
        }
      }
      return rt
    })
  runtime.catch(() => {}) // reported when the request arrives
  scope.addEventListener('message', async (event) => {
    try {
      const rt = await runtime
      post({ type: 'ready' })
      run(event.data as RunRequest, rt, post)
    } catch (e) {
      post({ type: 'error', error: e instanceof Error ? e.message : String(e) })
      return
    }
    post({ type: 'done' })
  })
}
