// Extractor tests: runs extension/src/extract.js (jobs), profile.js (LinkedIn profiles) and fill.js (application forms)
// inside headless Chrome against synthetic fixture pages.
// Run: node --test extension/test/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { fixtureUrl, launch, openPage, startServer } from './chrome.mjs'

const SRC = join(import.meta.dirname, '..', 'src')
const extractSrc = readFileSync(join(SRC, 'extract.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const clipSrc = readFileSync(join(SRC, 'clip.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const profileSrc = readFileSync(join(SRC, 'profile.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const fillSrc = readFileSync(join(SRC, 'fill.js'), 'utf8').replace(/^if \(typeof module.*$/m, '')
const PORT = 8880
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
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(m[1], 'base64url')).toString('utf8')), { ...job, clipper_version: '0.2.0' })
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
})

test('clipUrl halves raw_text until a profile clip fits the URL limit', async () => {
  const page = await openPage(cdp, 'about:blank')
  const r = await page.evaluate(`${clipSrc}
    (async () => {
      let s = 7, t = ''
      for (let i = 0; i < 120000; i++) { s = (s * 16807) % 2147483647; t += String.fromCharCode(97 + s % 26) }
      const url = await clipUrl('https://jivika.abhimanyu.fyi/app/', 'profile', { source: 'linkedin_profile', basics: { name: 'A' }, raw_text: t })
      const raw = await clipUrl('https://jivika.abhimanyu.fyi/app/', 'profile', { source: 'linkedin_profile', raw_text: t }, true)
      return { fits: !clipTooBig(url), rawTooBig: clipTooBig(raw), prefix: url.slice(0, 49) }
    })()`)
  assert.deepEqual(r, { fits: true, rawTooBig: true, prefix: 'https://jivika.abhimanyu.fyi/app/#profile?clip=z.' })
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
})

test('isLinkedInProfile', async () => {
  const { isLinkedInProfile } = createRequire(import.meta.url)('../src/clip.js')
  assert.ok(isLinkedInProfile('https://www.linkedin.com/in/kavya-example/'))
  assert.ok(isLinkedInProfile('https://in.linkedin.com/in/kavya-example/details/experience/'))
  assert.ok(!isLinkedInProfile('https://www.linkedin.com/jobs/view/123/'))
  assert.ok(!isLinkedInProfile('https://notlinkedin.com/in/x/'))
})

/* ---------- LinkedIn profile ---------- */

async function readProfile(path, opts = {}) {
  const page = await openPage(cdp, `https://www.linkedin.com${path}`)
  const p = await page.evaluate(`${profileSrc}\nextractProfile(${JSON.stringify(opts)})`)
  const scrollY = await page.evaluate('scrollY')
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
  return { p, scrollY }
}

test('linkedin profile: 2026 cards, unmarked entries, never clicks Activity', async () => {
  const page = await openPage(cdp, 'https://www.linkedin.com/in/2026-cards/')
  const p = await page.evaluate(`${profileSrc}\nextractProfile({})`)
  const hash = await page.evaluate('location.hash')
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
  assert.equal(hash, '', 'did not click the Activity "more" control or any link')
  assert.equal(p.basics.name, 'Riya Example')
  assert.equal(p.basics.headline, 'Platform Engineer at Example Cloud')
  assert.equal(p.basics.location, 'Greater Pune Area')
  assert.deepEqual(p.education.map((e) => [e.institution, e.degree, e.field, e.start, e.end, e.grade]), [
    ['Example Institute of Technology', 'Master of Technology', 'Data Engineering', 'Aug 2020', 'Jun 2022', '9.1/10'],
    ['Sample College', 'Bachelor of Engineering', 'Computer Science', '2016', '2020', ''],
  ])
  assert.deepEqual(p.languages, [{ name: 'English', level: 'Full professional proficiency' }, { name: 'Marathi', level: 'Native or bilingual proficiency' }])
  assert.ok(!p.sections_found.includes('activity'))
})

test('linkedin profile: lazy sections, see more, grouped roles, by meaning', async () => {
  const { p, scrollY } = await readProfile('/in/kavya-example/')
  assert.equal(scrollY, 0, 'scrolls back to where the reader was')
  assert.equal(p.source, 'linkedin_profile')
  assert.deepEqual(p.basics, {
    name: 'Kavya Example',
    headline: 'Senior Data Engineer at Example Analytics | Spark, Airflow, dbt',
    location: 'Pune, Maharashtra, India',
    summary: 'I build data platforms that analysts trust. Eight years across batch and streaming pipelines, most recently moving a retail analytics stack to near real time. I care about data contracts, tests and clear documentation.',
    linkedin: 'https://www.linkedin.com/in/kavya-example/',
  })
  assert.deepEqual(p.experience, [
    { company: 'Example Analytics', title: 'Senior Data Engineer', location: 'Hybrid', start: 'Jan 2024', end: '', current: true, employment_type: '',
      bullets: ['Led the move from nightly batch jobs to streaming ingestion with Kafka and Spark.', 'Cut warehouse cost by 30% by partitioning the largest fact tables.'] },
    { company: 'Example Analytics', title: 'Data Engineer', location: 'Pune, Maharashtra, India', start: 'Jan 2022', end: 'Dec 2023', current: false, employment_type: '',
      bullets: ['Built the dbt project used by four analytics teams.'] },
    { company: 'Sample Fintech', title: 'Software Engineer', location: 'Bengaluru, Karnataka, India, On-site', start: 'Jun 2018', end: 'Dec 2021', current: false, employment_type: 'Full-time',
      bullets: ['Wrote the payments reconciliation service in Python.'] },
    { company: 'Placeholder Labs', title: 'Data Intern', location: '', start: 'May 2017', end: 'Jul 2017', current: false, employment_type: 'Internship', bullets: [] },
  ])
  assert.deepEqual(p.education, [
    { institution: 'Example Institute of Technology', degree: 'Bachelor of Technology - BTech', field: 'Computer Science', start: '2014', end: '2018', grade: '8.4 CGPA', description: '' },
    { institution: 'Sample Junior College', degree: 'Higher Secondary', field: 'Science', start: '2012', end: '2014', grade: '', description: '' },
  ])
  assert.deepEqual(p.skills, [{ group: 'Skills', items: ['Apache Spark', 'dbt', 'SQL'] }])
  assert.deepEqual(p.languages, [{ name: 'English', level: 'Full professional proficiency' }, { name: 'Marathi', level: 'Native or bilingual proficiency' }])
  assert.deepEqual(p.certifications, [{ name: 'Example Cloud Data Engineer', issuer: 'Example Cloud Academy', year: '2024' }])
  assert.deepEqual(p.projects, [{ name: 'Open data quality checks', role: '', link: 'https://example.org/dq-checks', description: 'A small library of reusable data quality tests for dbt models.', bullets: [] }])
  assert.deepEqual(p.sections_found, ['summary', 'experience', 'education', 'certifications', 'projects', 'skills', 'languages'])
  assert.doesNotMatch(JSON.stringify(p.experience), /Recommendations|careful engineer/)
  assert.match(p.raw_text, /^Kavya Example/)
  assert.match(p.raw_text, /Recommendations/)
  assert.doesNotMatch(p.raw_text, /People also viewed|My Network/)
  assert.ok(p.raw_text.length <= 40000)
})

test('linkedin profile without preparing misses the lazy sections', async () => {
  const { p } = await readProfile('/in/kavya-example/', { prepare: false })
  assert.equal(p.education.length, 0)
  assert.match(p.basics.summary, /pipelines$/)
})

test('linkedin details/experience page', async () => {
  const { p } = await readProfile('/in/kavya-example/details/experience/')
  assert.equal(p.basics.name, '')
  assert.equal(p.basics.linkedin, 'https://www.linkedin.com/in/kavya-example/')
  assert.deepEqual(p.experience.map((e) => [e.title, e.company, e.employment_type, e.start, e.end]), [
    ['Software Engineer', 'Sample Fintech', 'Full-time', 'Jun 2018', 'Dec 2021'],
    ['Teaching Assistant', 'Example Institute of Technology', 'Part-time', '2016', '2017'],
  ])
  assert.deepEqual(p.sections_found, ['experience'])
})

/* ---------- Application forms ---------- */

const PROFILE = {
  basics: { name: 'Kavya Example', headline: 'Senior Data Engineer', email: 'kavya@example.com', phone: '+91 98765 43210', location: 'Pune, Maharashtra, India', linkedin: 'https://www.linkedin.com/in/kavya-example/', website: 'https://kavya.example.dev', summary: '' },
  experience: [
    { company: 'Example Analytics', title: 'Senior Data Engineer', location: 'Pune', start: 'Jan 2022', end: '', current: true, bullets: [] },
    { company: 'Sample Fintech', title: 'Software Engineer', location: 'Bengaluru', start: 'Jun 2018', end: 'Dec 2021', current: false, bullets: [] },
  ],
  education: [{ institution: 'Example Institute of Technology', degree: 'BTech', field: 'Computer Science', start: '2014', end: '2018', grade: '' }],
}
const ANSWERS = { notice_period: '30 days', expected_salary: '35 LPA', current_salary: '28 LPA', work_authorization: 'Yes', sponsorship_needed: 'No', willing_to_relocate: 'Yes', earliest_start: '2027-01-04', pronouns: 'she/her', github: 'https://github.com/kavya-example', how_heard: 'LinkedIn' }
const YEARS = String(new Date().getFullYear() - 2018)

async function fillPage(url, read) {
  const page = await openPage(cdp, url)
  const summary = await page.evaluate(`${fillSrc}\nfill(${JSON.stringify(PROFILE)}, ${JSON.stringify(ANSWERS)})`)
  const state = await page.evaluate(read)
  const again = await page.evaluate(`${fillSrc}\nfill(${JSON.stringify(PROFILE)}, ${JSON.stringify(ANSWERS)}).filled.length`)
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
  return { summary, state, again }
}
const values = (sel = 'input, select, textarea') => `Object.fromEntries([...document.querySelectorAll('${sel}')].filter((e) => e.type !== 'file' && e.type !== 'submit').map((e) => [e.name || e.id, e.type === 'checkbox' ? e.checked : e.type === 'radio' ? document.querySelector('input[name="' + CSS.escape(e.name) + '"]:checked')?.value ?? null : e.value]))`

test('greenhouse form', async () => {
  const { summary, state, again } = await fillPage(fixtureUrl('job-boards.greenhouse.io', 'greenhouse', '/northwind/jobs/123'),
    `({ v: ${values()}, outline: document.getElementById('email').style.outline, amber: document.getElementById('question_104').style.outline, note: document.querySelector('[data-jivika-note]')?.textContent, submitted: window.__submitted })`)
  assert.equal(summary.ats, 'greenhouse')
  assert.deepEqual(state.v, {
    'job_application[first_name]': 'Kavya', 'job_application[last_name]': 'Example', 'job_application[email]': 'kavya@example.com',
    'job_application[phone]': '+91 98765 43210', 'job_application[location]': 'Pune, Maharashtra, India',
    'job_application[answers_attributes][0][text_value]': 'https://www.linkedin.com/in/kavya-example/',
    'job_application[answers_attributes][1][text_value]': 'https://kavya.example.dev',
    'job_application[answers_attributes][2][boolean_value]': '0',
    'job_application[answers_attributes][3][text_value]': '',
    'job_application[answers_attributes][4][text_value]': 'LinkedIn',
    'job_application[gender]': '3', 'job_application[veteran_status]': '3',
  })
  assert.match(state.outline, /rgb\(31, 122, 77\) solid 2px/)
  assert.match(state.amber, /rgb\(181, 71, 8\) solid 2px/)
  assert.equal(state.note, 'Attach your resume here')
  assert.equal(state.submitted, 0)
  assert.equal(summary.filled.length, 11)
  assert.deepEqual(summary.needs_you, ['Resume/CV', 'Why do you want to work at Northwind Traders?'])
  assert.equal(again, 0, 'a second run leaves filled fields alone')
})

test('lever form: adapter names, yes/no radio, consent left to you', async () => {
  const { summary, state } = await fillPage(fixtureUrl('jobs.lever.co', 'lever', '/contoso/abc/apply'), `({ v: ${values()}, submitted: window.__submitted })`)
  assert.equal(summary.ats, 'lever')
  assert.deepEqual(state.v, {
    name: 'Kavya Example', email: 'kavya@example.com', phone: '+91 98765 43210', location: 'Pune, Maharashtra, India', org: 'Example Analytics',
    'urls[LinkedIn]': 'https://www.linkedin.com/in/kavya-example/', 'urls[GitHub]': 'https://github.com/kavya-example',
    'cards[abc][field0]': 'Yes', 'cards[abc][field1]': false, 'eeo[gender]': 'Decline to self-identify', 'eeo[race]': 'Decline to self-identify',
  })
  assert.deepEqual(summary.needs_you, ['Resume/CV', 'I agree to the privacy notice'])
  assert.equal(state.submitted, 0)
})

test('ashby form', async () => {
  const { summary, state } = await fillPage(fixtureUrl('jobs.ashbyhq.com', 'ashby', '/fabrikam/abc/application'), `({ v: ${values()}, clicked: window.__clicked })`)
  assert.equal(summary.ats, 'ashby')
  assert.deepEqual(state.v, {
    _systemfield_name: 'Kavya Example', _systemfield_email: 'kavya@example.com', f3a1: '+91 98765 43210', f3a2: 'https://www.linkedin.com/in/kavya-example/',
    f3a3: '30 days', f3a4: '35 LPA', f3a6: YEARS,
  })
  assert.deepEqual(summary.needs_you, ['Resume'])
  assert.equal(state.clicked, 0)
})

test('workday: React-style controlled inputs, current step only, country code, never presses Next', async () => {
  const { summary, state } = await fillPage(fixtureUrl('example.wd5.myworkdayjobs.com', 'workday', '/en-US/careers/job/apply'),
    `({ state: window.__state, code: document.getElementById('w4').value, next: window.__next })`)
  assert.equal(summary.ats, 'workday')
  assert.deepEqual(state.state, { w1: 'Kavya', w2: 'Example', w3: 'kavya@example.com', w5: '98765 43210', w6: 'Pune', w8: '', w9: '' })
  assert.equal(state.code, 'IN')
  assert.equal(state.next, 0)
  assert.deepEqual(summary.needs_you, ['How Did You Hear About Us?'])
  assert.match(summary.note, /one step at a time/)
})

test('workday fixture rejects plain value assignment (so the native setter is what makes it stick)', async () => {
  const page = await openPage(cdp, fixtureUrl('example.wd5.myworkdayjobs.com', 'workday'))
  const v = await page.evaluate(`const el = document.getElementById('w1'); el.value = 'Plain'; ['input', 'change', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true }))); [el.value, window.__state.w1]`)
  assert.deepEqual(v, ['', ''])
  await cdp.send('Target.closeTarget', { targetId: page.targetId })
})

test('smartrecruiters: fields inside open shadow roots', async () => {
  const { summary, state } = await fillPage(fixtureUrl('jobs.smartrecruiters.com', 'smartrecruiters', '/TailspinToys/123-quality-analyst'),
    `({ v: Object.fromEntries([...document.querySelectorAll('sr-field')].map((f) => [f.dataset.id, f.shadowRoot.querySelector('input').value])), clicked: window.__clicked })`)
  assert.equal(summary.ats, 'smartrecruiters')
  assert.deepEqual(state.v, {
    'first-name-input': 'Kavya', 'last-name-input': 'Example', 'email-input': 'kavya@example.com', 'confirm-email-input': 'kavya@example.com',
    'linkedin-input': 'https://www.linkedin.com/in/kavya-example/', 'spl-q-1': '30 days',
  })
  assert.equal(state.clicked, 0)
})

test('workable: legend radio, sponsorship checkbox left unchecked for No, existing values kept', async () => {
  const { summary, state } = await fillPage(fixtureUrl('apply.workable.com', 'workable', '/wingtip/j/ABC123/apply/'), `({ v: ${values()}, submitted: window.__submitted })`)
  assert.equal(summary.ats, 'workable')
  assert.deepEqual(state.v, {
    firstname: 'Kavya', lastname: 'Example', email: 'kavya@example.com', headline: 'Senior Data Engineer', phone: '+1 555 0100',
    address: 'Pune, Maharashtra, India', QA_8812: 'true', QA_8813: false, QA_8814: '',
  })
  assert.ok(summary.filled.includes('Are you willing to relocate?'))
  assert.ok(summary.skipped.includes('Phone'))
})

test('generic form: wrapping labels, aria-labelledby, placeholder, autocomplete, nearby text', async () => {
  const { summary, state } = await fillPage(fixtureUrl('jobs.contoso.test', 'generic-form'), `({ v: ${values()}, submitted: window.__submitted })`)
  assert.equal(summary.ats, '')
  assert.deepEqual(state.v, {
    f1: 'Kavya Example', f2: 'kavya@example.com', f3: '+91 98765 43210', f4: 'Pune', f5: 'BTech', f6: 'Example Institute of Technology', f7: '2018',
    f8: '28 LPA', f9: '35 LPA', f10: '2027-01-04', f11: 'https://kavya.example.dev', f12: 'she/her', f13: 'I do not want to answer', f14: '', token: 'abc',
  })
  assert.equal(state.submitted, 0)
  assert.deepEqual(summary.needs_you, [])
})

test('fields the user cannot see stay empty: off-screen, transparent, 1px', async () => {
  const { summary, state } = await fillPage(fixtureUrl('jobs.contoso.test', 'hidden-fields'), values())
  assert.equal(state.name, 'Kavya Example')
  assert.equal(state.salary, '')
  assert.equal(state.ethnicity, '')
  assert.equal(state.phone, '')
  assert.equal(state.relocate, 'Yes', 'a styled radio with a visible label is still answered')
  assert.ok(summary.filled.every((t) => !/salary|ethnicity|phone/i.test(t)))
})
