import { loadPyodide } from 'pyodide'
import { serve, STDOUT_CAP } from './shared'

declare const __PYODIDE_PATH__: string

// Runs inside Pyodide. The user's code gets its own namespace; stdout is captured per call; errors are
// reported with the line number in the user's code.
const HARNESS = `
import io, json, sys, traceback
_jv_fn = None

def _jv_err(e):
    line = e.lineno if isinstance(e, SyntaxError) and e.filename == '<solution>' else None
    for frame in traceback.extract_tb(e.__traceback__):
        if frame.filename == '<solution>':
            line = frame.lineno
    msg = ''.join(traceback.format_exception_only(type(e), e)).strip().splitlines()[-1]
    return f'Line {line}: {msg}' if line else msg

def _jv_default(o):
    if isinstance(o, (set, frozenset)):
        try:
            return sorted(o)
        except TypeError:
            return list(o)
    raise TypeError(f'{type(o).__name__} is not JSON serializable')

def _jv_setup(code, name):
    global _jv_fn
    ns = {'__name__': '__solution__'}
    sys.stdout = io.StringIO()
    try:
        exec(compile(code, '<solution>', 'exec'), ns)
    except BaseException as e:
        return _jv_err(e)
    finally:
        sys.stdout = sys.__stdout__
    if not callable(ns.get(name)):
        return f'Define a function named {name}.'
    _jv_fn = ns[name]
    return ''

def _jv_call(args):
    out = sys.stdout = io.StringIO()
    try:
        actual = json.dumps(_jv_fn(*json.loads(args)), default=_jv_default, allow_nan=False)
        return json.dumps({'actual': actual, 'stdout': out.getvalue()[:${STDOUT_CAP}]})
    except BaseException as e:
        return json.dumps({'error': _jv_err(e), 'stdout': out.getvalue()[:${STDOUT_CAP}]})
    finally:
        sys.stdout = sys.__stdout__
`

serve(
  async () => {
    const indexURL = new URL(import.meta.env.BASE_URL + __PYODIDE_PATH__, self.location.origin).href
    const py = await loadPyodide({ indexURL })
    py.runPython(HARNESS)
    return py
  },
  (req, py, post) => {
    if (req.lang !== 'python') throw new Error('Wrong runner.')
    const setupError = py.globals.get('_jv_setup')(req.code, req.fn) as string
    if (setupError) throw new Error(setupError)
    const call = py.globals.get('_jv_call')
    req.tests.forEach((args, index) => {
      const start = performance.now()
      const r = JSON.parse(call(args) as string) as { actual?: string; error?: string; stdout: string }
      post({ type: 'test', index, ...r, ms: performance.now() - start })
    })
  },
)
