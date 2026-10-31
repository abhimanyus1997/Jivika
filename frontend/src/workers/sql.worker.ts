import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { serve } from './shared'

serve(
  () => initSqlJs({ locateFile: () => wasmUrl }),
  (req, SQL, post) => {
    if (req.lang !== 'sql') throw new Error('Wrong runner.')
    const db = new SQL.Database()
    try {
      db.run(req.setup)
    } catch (e) {
      throw new Error(`The problem's table setup failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
    const start = performance.now()
    const last = db.exec(req.code).at(-1)
    const rows = (last?.values ?? []).map((row) => row.map((v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v)))
    post({ type: 'rows', columns: last?.columns ?? [], rows, ms: performance.now() - start })
    db.close()
  },
)
