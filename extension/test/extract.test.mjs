// Extractor tests: runs extension/src/extract.js inside headless Chrome against synthetic fixture pages.
// Run: node --test extension/test/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { fixtureUrl, launch, openPage, startServer } from './chrome.mjs'

const SRC = join(import.meta.dirname, '..', 'src')
const extractSrc = readFileSync(join(SRC, 'extract.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const clipSrc = readFileSync(join(SRC, 'clip.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const PORT = 8810
let server, cdp

before(async () => { server = await startServer(PORT); cdp = await launch(PORT) })
after(async () => { await cdp?.close(); server?.close() })

async function run(url) {
  const page = await openPage(cdp, url)
  const job = await page.evaluate(`${extractSrc}\nextract()`)
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
  return job
}

test('naukri job-listings page', async () => {
  const j = await run(fixtureUrl('www.naukri.com', 'naukri', '/job-listings-senior-platform-engineer-example-labs-6-to-9-years-123?src=jobsearchDesk&sid=1793&xp=1&px=1'))
  assert.equal(j.source, 'naukri')
  assert.equal(j.title, 'Senior Platform Engineer')
  assert.equal(j.company, 'Example Labs')
  assert.equal(j.experience_required, '6 - 9 years')
  assert.equal(j.salary, '18-28 Lacs P.A.')
  assert.equal(j.location, 'Bengaluru, Pune')
  assert.equal(j.employment_type, 'Full Time, Permanent')
  assert.equal(j.url, 'https://www.naukri.com/fixture/naukri/job-listings-senior-platform-engineer-example-labs-6-to-9-years-123')
  assert.match(j.description, /^About the role\n\nYou will own the internal platform/)
  assert.match(j.description, /\n- Design and run Kubernetes clusters across two regions\.\n- Build golden paths/)
  assert.match(j.description, /Lead incident reviews & reliability work\./)
  assert.match(j.description, /Must have 6\+ years with Go or Python\.\nExperience with Terraform/)
  assert.match(j.description, /Role: Platform Engineer\nIndustry Type: Software Product\nDepartment: Engineering - Software & QA\nEmployment Type: Full Time, Permanent\nRole Category: DevOps\nEducation: UG: B\.Tech/)
  assert.match(j.description, /Key Skills: Kubernetes, Terraform, Go$/)
  assert.doesNotMatch(j.description, /Apply|Recommended jobs|footer|sitemap/i)
})

test('linkedin 2026 layout with generated class names', async () => {
  const j = await run(fixtureUrl('www.linkedin.com', 'linkedin-2026', '/jobs/search-results/?currentJobId=5550001111&trackingId=x'))
  assert.equal(j.source, 'linkedin')
  assert.equal(j.title, 'Machine Learning Engineer')
  assert.equal(j.company, 'Example Analytics')
  assert.match(j.description, /^Role : Machine Learning Engineer/)
  assert.match(j.description, /- Train and evaluate ranking models\.\n- Ship models to production/)
  assert.match(j.description, /Location: Pune, hybrid\./)
  assert.match(j.description, /About the company\nExample Analytics\nSoftware Development \| 201-500 employees\nExample Analytics builds forecasting tools/)
  assert.doesNotMatch(j.description, /Determine your fit|People you can reach out to|followers|more$/)
})

test('linkedin jobs/view page', async () => {
  const j = await run(fixtureUrl('www.linkedin.com', 'linkedin-view', '/jobs/view/123?trk=public_jobs&refId=abc'))
  assert.equal(j.source, 'linkedin')
  assert.equal(j.title, 'Data Analyst')
  assert.equal(j.company, 'Example Fintech')
  assert.equal(j.location, 'Mumbai, Maharashtra, India')
  assert.equal(j.employment_type, 'Full-time')
  assert.equal(j.experience_required, 'Associate')
  assert.equal(j.url, 'https://www.linkedin.com/fixture/linkedin-view/jobs/view/123')
  assert.match(j.description, /^What you will do\n\n- Build dashboards for the lending team\n- Write SQL against our warehouse/)
  assert.doesNotMatch(j.description, /Show more/)
})

test('linkedin search detail pane, canonical URL from currentJobId', async () => {
  const j = await run(fixtureUrl('www.linkedin.com', 'linkedin-search', '/jobs/search/?currentJobId=4012345678&keywords=robotics'))
  assert.equal(j.title, 'Robotics Software Engineer')
  assert.equal(j.company, 'Acme Robotics')
  assert.equal(j.location, 'Pune, Maharashtra, India')
  assert.equal(j.url, 'https://www.linkedin.com/jobs/view/4012345678/')
  assert.match(j.description, /Acme builds warehouse robots\./)
  assert.match(j.description, /- Write C\+\+ and ROS 2 nodes\n- Own motion planning/)
  assert.doesNotMatch(j.description, /Frontend Developer at Other Co/)
})

test('indeed job view', async () => {
  const j = await run(fixtureUrl('in.indeed.com', 'indeed', '/viewjob?jk=abc&from=serp&vjk=1'))
  assert.equal(j.source, 'indeed')
  assert.equal(j.title, 'Support Engineer')
  assert.equal(j.company, 'Fabrikam')
  assert.equal(j.location, 'Hyderabad, Telangana')
  assert.equal(j.salary, '₹6,00,000 - ₹9,00,000 a year')
  assert.equal(j.url, 'https://in.indeed.com/fixture/indeed/viewjob?jk=abc')
  assert.match(j.description, /Help customers resolve integration issues by phone and chat\.\n\n- 2\+ years in support\n- Basic SQL/)
})

test('schema.org JobPosting in @graph, malformed block skipped, double-encoded HTML', async () => {
  const j = await run(fixtureUrl('careers.northwind.test', 'jsonld', '?utm_source=x&id=7#apply'))
  assert.equal(j.source, 'jsonld')
  assert.equal(j.title, 'Product Designer')
  assert.equal(j.company, 'Northwind Traders')
  assert.equal(j.location, 'Gurugram, HR, IN; Remote')
  assert.equal(j.employment_type, 'full time, contractor')
  assert.equal(j.experience_required, '4 years')
  assert.equal(j.salary, 'INR 2000000 - 3000000 per year')
  assert.equal(j.posted_at, '2026-10-20')
  assert.equal(j.url, 'https://careers.northwind.test/fixture/jsonld?id=7')
  assert.equal(j.description, 'Design delightful flows.\n\n- Own the design system\n- Run user research\n\nPortfolio required.')
})

test('generic page fallback ignores nav, aside and footer', async () => {
  const j = await run(fixtureUrl('jobs.contoso.test', 'generic'))
  assert.equal(j.source, 'page')
  assert.equal(j.title, 'Backend Engineer')
  assert.equal(j.company, 'Contoso')
  assert.match(j.description, /payment APIs/)
  assert.match(j.description, /- 5\+ years of backend experience\n- Strong SQL/)
  assert.doesNotMatch(j.description, /navigation|Related jobs|Copyright/)
  assert.ok(!('posted_at' in j))
})

test('clipUrl round-trips through deflate-raw base64url', async () => {
  const page = await openPage(cdp, 'about:blank')
  const job = { title: 'Engineer', company: 'जीविका', description: 'x'.repeat(30000) + ' é' }
  const url = await page.evaluate(`${clipSrc}\nclipUrl('http://localhost:5173/app/#old', 'cover', ${JSON.stringify(job)})`)
  const m = url.match(/^http:\/\/localhost:5173\/app\/#cover-letter\?clip=z\.([\w-]+)$/)
  assert.ok(m, url.slice(0, 80))
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(m[1], 'base64url')).toString('utf8')), job)
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
})
