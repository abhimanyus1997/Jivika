// Test helpers: a fixture server and a throwaway headless Chrome driven over the DevTools pipe.
// Chrome always gets a fresh temporary profile, and job-site hostnames resolve to the local fixture server,
// so tests never touch real sites or the user's browser.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURES = join(import.meta.dirname, 'fixtures')

// Throwaway self-signed certificate for the local https fixture server, generated per run (never committed).
function testCert() {
  const dir = mkdtempSync(join(tmpdir(), 'jivika-cert-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' })
  const tls = { key: readFileSync(key), cert: readFileSync(cert) }
  rmSync(dir, { recursive: true, force: true })
  return tls
}
const HOSTS = ['www.naukri.com', 'www.linkedin.com', 'in.indeed.com', 'careers.northwind.test', 'jobs.contoso.test', 'jivika.abhimanyu.fyi',
  'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'example.wd5.myworkdayjobs.com', 'jobs.smartrecruiters.com', 'apply.workable.com']

export function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!c) throw new Error('Chrome not found; set CHROME_PATH')
  return c
}

// Serves (over https) fixtures/<name>.html for /fixture/<name>/... on any host, LinkedIn-style profile paths
// (/in/<slug>/ -> profile-<slug>.html, /in/<slug>/details/<section>/ -> profile-<slug>-<section>.html) and a stub Jivika app at /app/.
export function startServer(port) {
  // Self-signed, test-only certificate: naukri.com and linkedin.com are HSTS-preloaded, so the fixtures must be served over https.
  const tls = testCert()
  const server = createServer(tls, (req, res) => {
    const m = req.url.match(/^\/fixture\/([\w-]+)/)
    const p = req.url.match(/^\/in\/([\w-]+)\/(?:details\/([\w-]+)\/)?/)
    const file = m ? join(FIXTURES, `${m[1]}.html`) : p ? join(FIXTURES, `profile-${p[1]}${p[2] ? `-${p[2]}` : ''}.html`) : req.url.startsWith('/app/') ? null : ''
    if (file === null) return res.end('<!doctype html><title>Jivika app stub</title><p>app</p>')
    if (!file || !existsSync(file)) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)))
}

export async function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), 'jivika-clipper-test-'))
  const proc = spawn(findChrome(), [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-sync', '--disable-component-update',
    '--ignore-certificate-errors', '--window-size=1280,800',
    // Background tabs keep rendering and running timers, so lazy sections and scroll listeners behave as in a focused tab.
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(', ')}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const out = proc.stdio[3], inp = proc.stdio[4]
  let id = 0, buf = ''
  const pending = new Map()
  inp.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? fail(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : ok(msg.result)
      }
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const m = { id: ++id, method, params }
    if (sessionId) m.sessionId = sessionId
    pending.set(m.id, { ok, fail })
    out.write(JSON.stringify(m) + '\0')
  })
  const close = async () => {
    try { await send('Browser.close') } catch { /* already gone */ }
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)))
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  // The default browser context exists only once the first tab is up; Extensions.* fails before that.
  await waitFor(async () => (await send('Target.getTargets')).targetInfos.some((t) => t.type === 'page'))
  return { send, close }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await sleep(100)
  }
}

// Opens a tab, attaches, waits for load. Returns { targetId, sessionId, evaluate }.
export async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const page = await attach(cdp, targetId)
  if (url !== 'about:blank') {
    await cdp.send('Page.navigate', { url }, page.sessionId)
    await waitFor(async () => (await page.evaluate('location.href !== "about:blank" && document.readyState').catch(() => '')) === 'complete')
  }
  return page
}

export async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async (expression, extra = {}) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...extra }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await waitFor(async () => (await evaluate('document.readyState').catch(() => '')) === 'complete')
  return { targetId, sessionId, evaluate }
}

export const fixtureUrl = (host, name, rest = '') => `https://${host}/fixture/${name}${rest}`
