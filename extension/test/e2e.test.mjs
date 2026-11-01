// End to end: builds the extension, loads it unpacked into a throwaway headless Chrome, opens a fixture job page,
// clicks the toolbar action, presses a popup button and checks the Jivika tab that opens carries the clip payload.
// Also runs the bookmarklet. Run: node --test extension/test/
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { attach, fixtureUrl, launch, openPage, startServer, waitFor } from './chrome.mjs'

const PORT = 8811
const EXT = join(import.meta.dirname, '..')
const APP = `https://localhost:${PORT}/app/`
let server, cdp, extId

const decode = (url) => {
  const m = url.match(/\?clip=(z\.)?([\w-]+)$/)
  const bytes = Buffer.from(m[2], 'base64url')
  return JSON.parse((m[1] ? inflateRawSync(bytes) : bytes).toString('utf8'))
}
const targets = async () => (await cdp.send('Target.getTargets')).targetInfos

before(async () => {
  execFileSync(process.execPath, [join(EXT, 'build.mjs')], { stdio: 'ignore' })
  server = await startServer(PORT)
  cdp = await launch(PORT)
  // Chrome rejects backslash paths here ("File path cannot be resolved"), so pass forward slashes.
  ;({ id: extId } = await cdp.send('Extensions.loadUnpacked', { path: join(EXT, 'dist', 'jivika-clipper').replaceAll('\\', '/') }))
  // Point the extension at the local stub app through its own options page.
  const options = await openPage(cdp, `chrome-extension://${extId}/options.html`)
  await waitFor(() => options.evaluate("document.getElementById('appUrl').value"))
  assert.equal(await options.evaluate(`document.getElementById('appUrl').value = 'ftp://example.com'; document.querySelector('form').requestSubmit(); document.getElementById('status').textContent`), 'Enter an https:// address, or http://localhost for local development.')
  await options.evaluate(`document.getElementById('appUrl').value = '${APP.slice(0, -1)}'; document.querySelector('form').requestSubmit()`)
  await waitFor(async () => (await options.evaluate("document.getElementById('status').textContent")) === 'Saved.')
  assert.equal(await options.evaluate("document.getElementById('appUrl').value"), APP)
  await cdp.send('Target.closeTarget', { targetId: options.targetId })
})
after(async () => { await cdp?.close(); server?.close() })

async function clip(url, button) {
  const before = new Set((await targets()).map((t) => t.targetId))
  const page = await openPage(cdp, url)
  // triggerAction wants the tab target (the parent of the page target), the same as clicking the toolbar button.
  const href = await page.evaluate('location.href')
  const tab = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find((t) => t.url === href)
  await cdp.send('Extensions.triggerAction', { id: extId, targetId: tab.targetId })
  const popupInfo = await waitFor(async () => (await targets()).find((t) => t.url === `chrome-extension://${extId}/popup.html`))
  const popup = await attach(cdp, popupInfo.targetId)
  const preview = await waitFor(() => popup.evaluate(`!document.querySelector('[data-page=match]').disabled && document.getElementById('preview').innerText`))
  await popup.evaluate(`document.querySelector('[data-page=${button}]').click()`)
  const opened = await waitFor(async () => (await targets()).find((t) => !before.has(t.targetId) && t.url.startsWith(APP)))
  for (const t of [page.targetId, opened.targetId]) await cdp.send('Target.closeTarget', { targetId: t }).catch(() => {})
  return { preview, url: opened.url }
}

test('manifest asks only for activeTab, scripting and storage', () => {
  const m = JSON.parse(readFileSync(join(EXT, 'dist', 'jivika-clipper', 'manifest.json'), 'utf8'))
  assert.deepEqual(m.permissions, ['activeTab', 'scripting', 'storage'])
  assert.equal(m.host_permissions, undefined)
  assert.equal(m.content_scripts, undefined)
  assert.equal(m.version, '0.1.0')
})

test('Naukri page -> Match in Jivika', async () => {
  const { preview, url } = await clip(fixtureUrl('www.naukri.com', 'naukri', '/job-listings-x-123?src=companyPageJobsDesk&sid=1&xp=1&px=1'), 'match')
  assert.match(preview, /Senior Platform Engineer\nExample Labs · Bengaluru, Pune\nNaukri/)
  assert.ok(url.startsWith(`${APP}#match?clip=z.`), url.slice(0, 80))
  const job = decode(url)
  assert.equal(job.source, 'naukri')
  assert.equal(job.title, 'Senior Platform Engineer')
  assert.equal(job.company, 'Example Labs')
  assert.equal(job.url, fixtureUrl('www.naukri.com', 'naukri', '/job-listings-x-123'))
  assert.match(job.description, /Key Skills: Kubernetes, Terraform, Go/)
})

test('LinkedIn search pane -> Cover letter', async () => {
  const { url } = await clip(fixtureUrl('www.linkedin.com', 'linkedin-search', '/jobs/search/?currentJobId=4012345678'), 'cover')
  assert.ok(url.startsWith(`${APP}#cover-letter?clip=`))
  const job = decode(url)
  assert.equal(job.title, 'Robotics Software Engineer')
  assert.equal(job.url, 'https://www.linkedin.com/jobs/view/4012345678/')
})

test('JSON-LD page -> ATS check and Interview prep', async () => {
  for (const [button, page] of [['ats', 'ats'], ['interview', 'interview']]) {
    const { url } = await clip(fixtureUrl('careers.northwind.test', 'jsonld'), button)
    assert.ok(url.startsWith(`${APP}#${page}?clip=`))
    assert.equal(decode(url).source, 'jsonld')
  }
})

test('bookmarklet opens the default app URL with the clip', async () => {
  const code = decodeURIComponent(readFileSync(join(EXT, 'dist', 'bookmarklet.txt'), 'utf8').trim().replace(/^javascript:/, ''))
  const before = new Set((await targets()).map((t) => t.targetId))
  const page = await openPage(cdp, fixtureUrl('in.indeed.com', 'indeed', '/viewjob?jk=1'))
  await page.evaluate(code, { userGesture: true, awaitPromise: false })
  const opened = await waitFor(async () => (await targets()).find((t) => !before.has(t.targetId) && t.url.includes('?clip=')))
  assert.ok(opened.url.startsWith('https://jivika.abhimanyu.fyi/app/#match?clip=z.'), opened.url.slice(0, 80))
  assert.equal(decode(opened.url).title, 'Support Engineer')
  for (const t of [page.targetId, opened.targetId]) await cdp.send('Target.closeTarget', { targetId: t }).catch(() => {})
})
