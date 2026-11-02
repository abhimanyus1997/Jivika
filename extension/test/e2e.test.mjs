// End to end: builds the extension, loads it unpacked into a throwaway headless Chrome, opens fixture pages,
// clicks the toolbar action, presses popup buttons and checks the Jivika tab that opens carries the clip payload.
// Also covers the app connection (externally_connectable), LinkedIn profile import, Fill this application,
// options and the bookmarklet. Run: node --test extension/test/
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { attach, fixtureUrl, launch, openPage, startServer, waitFor } from './chrome.mjs'

const PORT = 8881
const EXT = join(import.meta.dirname, '..')
const APP = `https://localhost:${PORT}/app/`
let server, cdp, extId, app

const decode = (url) => {
  const m = url.match(/\?clip=(z\.)?([\w-]+)$/)
  const bytes = Buffer.from(m[2], 'base64url')
  return JSON.parse((m[1] ? inflateRawSync(bytes) : bytes).toString('utf8'))
}
const targets = async () => (await cdp.send('Target.getTargets')).targetInfos
const close = async (...ids) => { for (const t of ids) await cdp.send('Target.closeTarget', { targetId: t }).catch(() => {}) }

// A message from the Jivika app page (https://jivika.abhimanyu.fyi, served by the fixture server) to the extension.
const send = (msg) => app.evaluate(`new Promise((ok) => chrome.runtime.sendMessage(${JSON.stringify(extId)}, ${JSON.stringify(msg)}, ok))`)

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
  await close(options.targetId)
  app = await openPage(cdp, 'https://jivika.abhimanyu.fyi/app/')
})
after(async () => { await cdp?.close(); server?.close() })

// Opens the page, clicks the toolbar action and attaches to the popup.
async function openPopup(url) {
  const page = await openPage(cdp, url)
  // triggerAction wants the tab target (the parent of the page target), the same as clicking the toolbar button.
  const href = await page.evaluate('location.href')
  const tab = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find((t) => t.url === href)
  // Wait out any popup still closing from an earlier test, then take the new one.
  await waitFor(async () => !(await targets()).some((t) => t.url === `chrome-extension://${extId}/popup.html`))
  await cdp.send('Extensions.triggerAction', { id: extId, targetId: tab.targetId })
  const popupInfo = await waitFor(async () => (await targets()).find((t) => t.url === `chrome-extension://${extId}/popup.html`))
  return { page, popup: await attach(cdp, popupInfo.targetId) }
}

// Presses a popup button and returns the URL of the Jivika tab it opens.
async function press(popup, selector, prefix = APP) {
  const before = new Set((await targets()).map((t) => t.targetId))
  await popup.evaluate(`document.querySelector('${selector}').click()`)
  const opened = await waitFor(async () => (await targets()).find((t) => !before.has(t.targetId) && t.url.startsWith(prefix)), 20000)
  await close(opened.targetId)
  return opened.url
}

async function clip(url, button) {
  const { page, popup } = await openPopup(url)
  const preview = await waitFor(() => popup.evaluate(`!document.querySelector('[data-page=match]').disabled && document.getElementById('preview').innerText`))
  const checklist = await popup.evaluate(`[...document.querySelectorAll('#checklist li')].map((li) => li.getAttribute('aria-label'))`)
  const warning = await popup.evaluate(`document.getElementById('warning').hidden ? '' : document.getElementById('warning').textContent`)
  const footer = await popup.evaluate(`document.querySelector('.version').textContent`)
  const fillShown = await popup.evaluate(`!document.getElementById('fill').hidden`)
  const opened = await press(popup, `[data-page=${button}]`)
  await close(page.targetId)
  return { preview, checklist, warning, footer, fillShown, url: opened }
}

test('manifest: activeTab, scripting and storage, optional per-site access, fixed key, app connection', () => {
  const m = JSON.parse(readFileSync(join(EXT, 'dist', 'jivika-clipper', 'manifest.json'), 'utf8'))
  assert.deepEqual(m.permissions, ['activeTab', 'scripting', 'storage'])
  assert.deepEqual(m.optional_host_permissions, ['https://*/*'])
  assert.equal(m.host_permissions, undefined)
  assert.equal(m.content_scripts, undefined)
  assert.equal(m.version, '0.2.0')
  assert.deepEqual(m.externally_connectable.matches, ['https://jivika.abhimanyu.fyi/*', 'http://localhost/*', 'http://127.0.0.1/*'])
  // The extension ID is derived from the public key, so every unpacked copy gets the same one.
  const id = [...createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('')
  assert.equal(id, extId)
  assert.equal(id, 'agnjhcpbahadbpobhkjnjifepombmjdo')
})

test('Naukri page -> Match in Jivika, with checklist and version', async () => {
  const { preview, checklist, warning, footer, fillShown, url } = await clip(fixtureUrl('www.naukri.com', 'naukri', '/job-listings-x-123?src=companyPageJobsDesk&sid=1&xp=1&px=1'), 'match')
  assert.match(preview, /Senior Platform Engineer\nExample Labs · Bengaluru, Pune\nNaukri/)
  assert.deepEqual(checklist.slice(0, 6), ['Title: found', 'Company: found', 'Location: found', 'Experience: found', 'Salary: found', 'Employment type: found'])
  assert.match(checklist[6], /^Description \([\d,]+ characters\): found$/)
  assert.equal(checklist[7], 'Key skills: found')
  assert.equal(warning, '')
  assert.equal(footer, 'Version 0.2.0')
  assert.ok(fillShown)
  assert.ok(url.startsWith(`${APP}#match?clip=z.`), url.slice(0, 80))
  const job = decode(url)
  assert.equal(job.source, 'naukri')
  assert.equal(job.clipper_version, '0.2.0')
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

test('JSON-LD page -> ATS check, Interview prep and Track this application', async () => {
  for (const [button, page] of [['ats', 'ats'], ['interview', 'interview'], ['track', 'new-application']]) {
    const { url } = await clip(fixtureUrl('careers.northwind.test', 'jsonld'), button)
    assert.ok(url.startsWith(`${APP}#${page}?clip=`))
    const job = decode(url)
    assert.equal(job.source, 'jsonld')
    assert.equal(job.status, button === 'track' ? 'Applied' : undefined)
    if (button === 'track') assert.equal(job.url, 'https://careers.northwind.test/fixture/jsonld')
  }
})

test('short description shows the scroll-and-retry warning', async () => {
  const { checklist, warning } = await clip(fixtureUrl('jobs.contoso.test', 'greenhouse-embed'), 'match')
  assert.equal(checklist[0], 'Title: found')
  assert.equal(checklist[1], 'Company: not found')
  assert.equal(warning, 'The description looks short. Scroll the job details into view or expand them, then clip again.')
})

test('app connection: only allowed origins, ping, size cap, sync', async () => {
  assert.deepEqual(await send({ type: 'jivika.ping' }), { ok: true, version: '0.2.0', connected: false, syncedAt: null })
  // Pages outside externally_connectable cannot reach the extension at all.
  const other = await openPage(cdp, fixtureUrl('careers.northwind.test', 'jsonld'))
  assert.equal(await other.evaluate('typeof globalThis.chrome?.runtime?.sendMessage'), 'undefined')
  await close(other.targetId)
  assert.deepEqual(await send({ type: 'jivika.sync', profile: { basics: { name: 'x'.repeat(210 * 1024) } } }), { ok: false, error: 'This is too large for Jivika Clipper (over 200 KB).' })
  assert.deepEqual(await send({ type: 'jivika.sync', profile: [] }), { ok: false, error: 'The profile is missing.' })
  assert.deepEqual(await send({ type: 'jivika.nope' }), { ok: false, error: 'Unknown message.' })
  // Only known fields are kept, as strings; the byte size (not the character count) is capped.
  assert.equal((await send({ type: 'jivika.sync', profile: { basics: { name: { x: 1 }, email: 'a@example.com' }, extra: 'x', experience: [{ title: 'Analyst', current: true, bullets: [1] }, 'x'] } })).ok, true)
  const options = await openPage(cdp, `chrome-extension://${extId}/options.html`)
  assert.deepEqual(await options.evaluate(`chrome.storage.local.get('profile').then((s) => s.profile)`), { basics: { email: 'a@example.com' }, experience: [{ title: 'Analyst', current: true }], education: [] })
  await close(options.targetId)
  assert.deepEqual(await send({ type: 'jivika.sync', profile: { basics: { name: '\u0939'.repeat(70 * 1024) } } }), { ok: false, error: 'This is too large for Jivika Clipper (over 200 KB).' })
  assert.deepEqual(await send({ type: 'jivika.disconnect' }), { ok: true })
})

test('Fill this application before connecting explains how to connect', async () => {
  const { page, popup } = await openPopup(fixtureUrl('job-boards.greenhouse.io', 'greenhouse'))
  await waitFor(() => popup.evaluate(`!document.getElementById('fill').hidden`))
  await popup.evaluate(`document.getElementById('fill-run').click()`)
  const status = await waitFor(() => popup.evaluate(`document.getElementById('fill-status').textContent.includes('Connect') && document.getElementById('fill-status').textContent`))
  assert.match(status, /^Connect your Jivika profile first: .* Open Jivika settings$/)
  assert.equal(await page.evaluate(`document.getElementById('email').value`), '')
  await close(page.targetId, popup.targetId)
})

const PROFILE = {
  basics: { name: 'Kavya Example', headline: 'Senior Data Engineer', email: 'kavya@example.com', phone: '+91 98765 43210', location: 'Pune, Maharashtra, India', linkedin: 'https://www.linkedin.com/in/kavya-example/', website: '', summary: '' },
  experience: [{ company: 'Example Analytics', title: 'Senior Data Engineer', location: 'Pune', start: 'Jan 2022', end: '', current: true, bullets: [] }],
  education: [], skills: [], languages: [], certifications: [], projects: [], publications: [], references: [],
}

test('Connect, then Fill this application reaches the form inside a same-site iframe', async () => {
  const r = await send({ type: 'jivika.sync', profile: PROFILE, answers: { sponsorship_needed: 'No', notice_period: 30, how_heard: 'Company website' }, appUrl: 'https://evil.example/app/' })
  assert.equal(r.ok, true)
  const ping = await send({ type: 'jivika.ping' })
  assert.equal(ping.connected, true)
  assert.equal(typeof ping.syncedAt, 'number')

  const { page, popup } = await openPopup(fixtureUrl('careers.northwind.test', 'greenhouse-embed'))
  await waitFor(() => popup.evaluate(`!document.getElementById('fill').hidden`))
  await popup.evaluate(`document.getElementById('fill-run').click()`)
  const status = await waitFor(() => popup.evaluate(`/^Filled/.test(document.getElementById('fill-status').textContent) && document.getElementById('fill-status').textContent`))
  assert.match(status, /^Filled 10 fields\. 2 need you: Resume\/CV, Why do you want to work at Northwind Traders\?\./)
  assert.match(status, /Nothing was submitted/)
  const v = await page.evaluate(`(() => { const d = document.getElementById('grnhse_iframe').contentDocument; return ['first_name', 'email', 'question_103', 'question_105', 'job_application_gender'].map((id) => d.getElementById(id).value) })()`)
  // notice_period was not a string, so it was dropped; EEO answers default to declining.
  assert.deepEqual(v, ['Kavya', 'kavya@example.com', '0', 'Company website', '3'])
  await close(page.targetId, popup.targetId)
})

test('LinkedIn profile -> Import to my profile and Review my LinkedIn', async () => {
  for (const [button, hash] of [['profile', 'profile'], ['linkedin', 'linkedin']]) {
    const { page, popup } = await openPopup('https://www.linkedin.com/in/kavya-example/')
    await waitFor(() => popup.evaluate(`document.getElementById('job-actions').hidden && !document.getElementById('profile-actions').hidden`))
    const preview = await waitFor(() => popup.evaluate(`!document.querySelector('[data-page=profile]').disabled && document.getElementById('preview').innerText`), 20000)
    assert.equal(preview, 'Kavya Example\nSenior Data Engineer at Example Analytics | Spark, Airflow, dbt\nLinkedIn profile')
    const checklist = await popup.evaluate(`[...document.querySelectorAll('#checklist li')].map((li) => li.getAttribute('aria-label'))`)
    assert.ok(checklist.includes('Experience (4): found'), checklist.join('; '))
    assert.ok(checklist.includes('Education (2): found'))
    assert.equal(await popup.evaluate(`document.getElementById('fill').hidden`), true)
    const url = await press(popup, `[data-page=${button}]`)
    assert.ok(url.startsWith(`${APP}#${hash}?clip=z.`), url.slice(0, 80))
    const p = decode(url)
    assert.equal(p.source, 'linkedin_profile')
    assert.equal(p.clipper_version, '0.2.0')
    assert.equal(p.basics.name, 'Kavya Example')
    assert.equal(p.experience.length, 4)
    assert.equal(p.education.length, 2)
    await close(page.targetId)
  }
})

test('a profile too large for the URL goes through the app bridge (fetchClip) when connected', async () => {
  const { page, popup } = await openPopup('https://www.linkedin.com/in/large-example/')
  await waitFor(() => popup.evaluate(`!document.querySelector('[data-page=profile]').disabled`), 30000)
  const url = await press(popup, '[data-page=profile]')
  const m = url.match(/#profile\?clipRef=([\w-]+)$/)
  assert.ok(m, url.slice(0, 120))
  const r = await send({ type: 'jivika.fetchClip', id: m[1] })
  assert.equal(r.ok, true)
  assert.equal(r.payload.source, 'linkedin_profile')
  assert.equal(r.payload.clipper_version, '0.2.0')
  assert.equal(r.payload.experience.length, 70)
  assert.deepEqual(await send({ type: 'jivika.fetchClip', id: m[1] }), { ok: false, error: 'This clip is no longer available. Clip the page again.' })
  assert.deepEqual(await send({ type: 'jivika.fetchClip', id: '../x' }), { ok: false, error: 'Unknown clip.' })
  await close(page.targetId)
})

test('options: connected profile, in-page button sites list and remove', async () => {
  const options = await openPage(cdp, `chrome-extension://${extId}/options.html`)
  await waitFor(() => options.evaluate(`document.getElementById('conn').textContent.startsWith('Your profile')`))
  assert.equal(await options.evaluate(`document.getElementById('version').textContent`), '0.2.0')
  await waitFor(() => options.evaluate(`document.getElementById('sites').textContent.startsWith('None yet')`))
  await options.evaluate(`chrome.scripting.registerContentScripts([{ id: 'site-https___jobs_lever_co', matches: ['https://jobs.lever.co/*'], js: ['button.js'] }]).then(() => location.reload())`).catch(() => {})
  await waitFor(async () => (await options.evaluate(`document.querySelector('#sites li span')?.textContent || ''`).catch(() => '')) === 'jobs.lever.co')
  await options.evaluate(`document.querySelector('#sites button').click()`)
  await waitFor(() => options.evaluate(`document.getElementById('sites').textContent.startsWith('None yet')`))
  assert.deepEqual(await options.evaluate(`chrome.scripting.getRegisteredContentScripts().then((s) => s.length)`), 0)
  await close(options.targetId)
})

test('disconnect clears the profile and answers', async () => {
  assert.deepEqual(await send({ type: 'jivika.disconnect' }), { ok: true })
  assert.equal((await send({ type: 'jivika.ping' })).connected, false)
})

test('bookmarklet opens the default app URL with the clip and its version', async () => {
  const code = decodeURIComponent(readFileSync(join(EXT, 'dist', 'bookmarklet.txt'), 'utf8').trim().replace(/^javascript:/, ''))
  const before = new Set((await targets()).map((t) => t.targetId))
  const page = await openPage(cdp, fixtureUrl('in.indeed.com', 'indeed', '/viewjob?jk=1'))
  await page.evaluate(code, { userGesture: true, awaitPromise: false })
  const opened = await waitFor(async () => (await targets()).find((t) => !before.has(t.targetId) && t.url.includes('?clip=')))
  assert.ok(opened.url.startsWith('https://jivika.abhimanyu.fyi/app/#match?clip=z.'), opened.url.slice(0, 80))
  assert.equal(decode(opened.url).title, 'Support Engineer')
  assert.equal(decode(opened.url).clipper_version, '0.2.0')
  await close(page.targetId, opened.targetId)
})

test('bookmarklet on a LinkedIn profile imports it', async () => {
  const code = decodeURIComponent(readFileSync(join(EXT, 'dist', 'bookmarklet.txt'), 'utf8').trim().replace(/^javascript:/, ''))
  const before = new Set((await targets()).map((t) => t.targetId))
  const page = await openPage(cdp, 'https://www.linkedin.com/in/kavya-example/')
  await page.evaluate(code, { userGesture: true, awaitPromise: false })
  // window.open may lose the click's activation while the profile loads; the bookmarklet then navigates the tab instead.
  const url = await waitFor(async () => {
    const t = (await targets()).find((x) => (!before.has(x.targetId) || x.targetId === page.targetId) && x.url.includes('#profile?clip='))
    return t && t.url
  }, 20000)
  assert.ok(url.startsWith('https://jivika.abhimanyu.fyi/app/#profile?clip=z.'))
  const p = decode(url)
  assert.equal(p.source, 'linkedin_profile')
  assert.equal(p.education.length, 2)
  for (const t of await targets()) if (!before.has(t.targetId) || t.targetId === page.targetId) await close(t.targetId)
})
