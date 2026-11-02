// Checks for the portability formats. No test framework.
//   node --experimental-strip-types src/lib/portability/__tests__/portability.test.mjs [path/to/jsonresume-schema.json]
// The same file runs in a browser (browser.html) where DOMParser is available, which adds the XML checks.

/* ---------- Environment stubs for Node (store.ts touches window and localStorage) ---------- */

class MemoryStorage {
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null
  }
  setItem(k, v) {
    this[k] = String(v)
  }
  removeItem(k) {
    delete this[k]
  }
  clear() {
    for (const k of Object.keys(this)) delete this[k]
  }
}
const inNode = typeof window === 'undefined'
if (inNode) {
  globalThis.window = { addEventListener() {}, dispatchEvent() {} }
  globalThis.localStorage = new MemoryStorage()
  globalThis.sessionStorage = new MemoryStorage()
  globalThis.StorageEvent = class StorageEvent {}
  globalThis.location = { origin: 'https://jivika.test', pathname: '/app/', hash: '' }
  // App modules import siblings without an extension ('./store'), as Vite allows; resolve those to .ts here.
  const hook = `export async function resolve(s, c, next) {
    try { return await next(s, c) } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.\\w+$/.test(s)) return next(s + '.ts', c); throw e }
  }`
  ;(await import('node:module')).register('data:text/javascript,' + encodeURIComponent(hook))
} else {
  localStorage.clear()
}

const zip = await import('../zip.ts')
const csv = await import('../csv.ts')
const jr = await import('../jsonresume.ts')
const europass = await import('../europass.ts')
const md = await import('../markdown.ts')
const xml = await import('../xml.ts')
const detect = await import('../detect.ts')
const imp = await import('../import.ts')
const li = await import('../linkedin-export.ts')
const lp = await import('../linkedin-profile.ts')
const snapshot = await import('../snapshot.ts')
const ics = await import('../../ics.ts')

let passed = 0
const failures = []
let section = ''
const log = (...a) => (inNode ? console.log(...a) : (document.getElementById('out').textContent += a.join(' ') + '\n'))
function ok(cond, msg) {
  if (cond) passed++
  else failures.push(`${section}: ${msg}`)
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n    got      ${JSON.stringify(a)}\n    expected ${JSON.stringify(b)}`)
async function rejects(fn, re, msg) {
  try {
    await fn()
    ok(false, `${msg} (no error)`)
  } catch (e) {
    ok(re.test(String(e?.message ?? e)), `${msg} (wrong error: ${e?.message})`)
  }
}
const bytes = (s) => new TextEncoder().encode(s)

/* ---------- Fixtures ---------- */

const PROFILE = {
  basics: {
    name: 'Asha Rao',
    headline: 'Senior Data Analyst',
    email: 'asha@example.com',
    phone: '+91 98765 43210',
    location: 'Bengaluru, Karnataka, IN',
    linkedin: 'https://www.linkedin.com/in/asha-rao',
    website: 'https://asha.example.com',
    summary: 'Analyst with 6 years in retail & fintech. Builds "decision" dashboards <fast>.',
  },
  experience: [
    { id: 'e1', company: 'Acme Retail', title: 'Senior Data Analyst', location: 'Bengaluru', start: 'Mar 2021', end: '', current: true, bullets: ['Cut reporting time by 40%', 'Led a team of 3'] },
    { id: 'e2', company: 'PayCo', title: 'Data Analyst', location: 'Pune', start: 'Jun 2018', end: 'Feb 2021', current: false, bullets: ['Built fraud KPIs'] },
  ],
  projects: [{ id: 'p1', name: 'Churn model', role: 'Lead', link: 'https://github.com/asha/churn', description: 'Predicts churn', bullets: ['AUC 0.84'] }],
  education: [{ id: 'd1', institution: 'IIT Madras', degree: 'B.Tech', field: 'Computer Science', start: 'Jul 2014', end: 'May 2018', grade: '8.6 CGPA' }],
  skills: [
    { id: 's1', group: 'Languages', items: ['SQL', 'Python'] },
    { id: 's2', group: 'Tools', items: ['Power BI', 'dbt'] },
  ],
  languages: [
    { id: 'l1', name: 'English', level: 'Fluent' },
    { id: 'l2', name: 'Kannada', level: 'Native' },
  ],
  certifications: [{ id: 'c1', name: 'AWS Data Analytics', issuer: 'Amazon', year: '2022' }],
  publications: [{ id: 'u1', citation: 'Rao A. Retail demand signals, 2023' }],
  references: [{ id: 'r1', name: 'K. Iyer', relation: 'Manager at Acme', contact: 'k@example.com' }],
}
const strip = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'id' ? undefined : v)))

const APPS = [
  {
    id: 'a1', company: 'Acme, Inc.', role: 'Analyst "II"', date: '2026-10-01', status: 'Interview', link: 'https://acme.example/jobs/1',
    notes: 'Line one\nLine two', sent: '2026-10-02', deadline: '2026-10-20', location: 'Remote, India', work_mode: 'Remote', salary: '30 LPA', match: 82,
    history: [{ status: 'Applied', date: '2026-10-01' }, { status: 'Interview', date: '2026-10-05' }],
    interviews: [{ id: 'i1', date: '2026-10-08', time: '14:30', duration_min: 45, title: 'Technical round', notes: 'Bring laptop' }],
    followups: [{ id: 'f1', date: '2026-10-12', note: 'Chase recruiter', done: false }],
  },
  { id: 'a2', company: '=cmd()', role: '@risky', date: '2026-09-15', status: 'Draft', link: '', notes: '-starts with minus', deadline: '2026-11-01', history: [{ status: 'Draft', date: '2026-09-15' }] },
]

/* ---------- ZIP ---------- */
section = 'zip'
{
  eq(zip.crc32(bytes('123456789')), 0xcbf43926, 'CRC32 check value')
  const files = [
    { name: 'a.txt', data: 'hello' },
    { name: 'folder/ünïcode.txt', data: 'नमस्ते' },
    { name: 'empty.txt', data: '' },
  ]
  const z = zip.writeZip(files)
  ok(zip.isZip(z), 'signature')
  eq(zip.zipNames(z), files.map((f) => f.name), 'names')
  const back = await zip.readZip(z)
  eq(back.map((e) => [e.name, new TextDecoder().decode(e.data)]), files.map((f) => [f.name, f.data]), 'stored round trip')

  // A DEFLATE entry, compressed with CompressionStream and wrapped by hand.
  async function deflated(name, data) {
    const comp = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const stored = zip.writeZip([{ name, data }])
    const v = new DataView(stored.buffer)
    const nameLen = v.getUint16(26, true)
    const head = stored.slice(0, 30 + nameLen)
    const cen = stored.slice(30 + nameLen + data.length, stored.length - 22)
    const end = stored.slice(stored.length - 22)
    const hv = new DataView(head.buffer)
    hv.setUint16(8, 8, true)
    hv.setUint32(18, comp.length, true)
    const cv = new DataView(cen.buffer)
    cv.setUint16(10, 8, true)
    cv.setUint32(20, comp.length, true)
    const ev = new DataView(end.buffer)
    ev.setUint32(16, head.length + comp.length, true)
    const out = new Uint8Array(head.length + comp.length + cen.length + end.length)
    out.set(head, 0)
    out.set(comp, head.length)
    out.set(cen, head.length + comp.length)
    out.set(end, head.length + comp.length + cen.length)
    return out
  }
  const text = bytes('Positions and education, repeated. '.repeat(200))
  const dz = await deflated('Positions.csv', text)
  const [entry] = await zip.readZip(dz)
  eq(new TextDecoder().decode(entry.data), new TextDecoder().decode(text), 'DEFLATE round trip via DecompressionStream')

  const bomb = await deflated('zeros.bin', new Uint8Array(3 * 1024 * 1024))
  await rejects(() => zip.readZip(bomb), /suspiciously|expands/, 'ratio cap rejects a 3 MB file of zeros')
  await rejects(() => zip.readZip(z, () => true, { ...zip.ZIP_LIMITS, maxTotal: 3 }), /expands to more/, 'total size cap')
  await rejects(() => zip.readZip(z, () => true, { ...zip.ZIP_LIMITS, maxBytes: 10 }), /larger than/, 'archive size cap')
  const many = zip.writeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}`, data: '' })))
  await rejects(() => zip.readZip(many), /more than 2000 entries/, 'entry cap')
  const broken = z.slice()
  broken[36] ^= 0xff // corrupt the first file's data ('hello' starts at 30 + 5)
  await rejects(() => zip.readZip(broken), /checksum/, 'CRC mismatch detected')
}

/* ---------- CSV ---------- */
section = 'csv'
{
  const rows = [['a', 'b,c', 'say "hi"'], ['multi\nline', '', 'ü']]
  eq(csv.parseCsv(csv.toCsv(rows)), rows, 'RFC 4180 round trip')
  eq(csv.parseCsv('x;y\r\n1;2\r\n', ';'), [['x', 'y'], ['1', '2']], 'semicolon delimiter')
  eq(csv.sniffDelimiter('Company\tRole\tStatus'), '\t', 'sniff tab')
  for (const c of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) ok(csv.defuse(c).startsWith("'"), `defuse ${JSON.stringify(c)}`)
  ok(csv.defuse('Acme') === 'Acme', 'plain cell untouched')

  const out = csv.applicationsToCsv(APPS)
  ok(out.charCodeAt(0) === 0xfeff, 'UTF-8 BOM')
  ok(out.includes('\r\n'), 'CRLF line ends')
  const parsed = csv.parseCsv(out)
  eq(parsed[0], [...csv.APP_COLUMNS], 'header columns in spec order')
  ok(parsed[2][0] === "'=cmd()" && parsed[2][1] === "'@risky", 'formula injection guarded in output')
  const back = csv.rowsToApplications(parsed.slice(1), csv.autoMap(parsed[0]), {}, () => 'id')
  eq(
    back.map((a) => [a.company, a.role, a.status, a.date, a.sent ?? '', a.deadline ?? '', a.location ?? '', a.work_mode ?? '', a.salary ?? '', a.link, a.match ?? '', a.notes]),
    APPS.map((a) => [a.company, a.role, a.status, a.date, a.sent ?? '', a.deadline ?? '', a.location ?? '', a.work_mode ?? '', a.salary ?? '', a.link, a.match ?? '', a.notes]),
    'applications CSV round trip',
  )
  eq(csv.autoMap(['Employer', 'Job Title', 'Stage', 'Date Applied', 'URL', 'Organisation']), { company: 0, role: 1, status: 2, date: 3, link: 4 }, 'header synonyms')
  const statuses = {
    Wishlist: 'Draft', Saved: 'Draft', 'Phone screen': 'Screening', 'Recruiter call': 'Screening', Onsite: 'Interview', 'Final round': 'Interview',
    Ghosted: 'Applied', 'No response': 'Applied', Rejected: 'Rejected', 'Declined by company': 'Rejected', Withdrawn: 'Withdrawn', Offer: 'Offer',
    Accepted: 'Accepted', 'Rejected after interview': 'Rejected',
  }
  for (const [ext, st] of Object.entries(statuses)) eq(csv.mapStatus(ext), st, `status ${ext}`)
  eq(csv.parseDate('31/12/2025'), '2025-12-31', 'd/m/y')
  eq(csv.parseDate('12/31/2025'), '2025-12-31', 'm/d/y when unambiguous')
  eq(csv.parseDate('2025-3-7'), '2025-03-07', 'ISO short')
}

/* ---------- JSON Resume ---------- */
section = 'jsonresume'
{
  eq(['Mar 2020', 'March 2020', '03/2020', '2020', '2020-03-14', 'Present', 'Summer 2019'].map(jr.toIsoDate), ['2020-03', '2020-03', '2020-03', '2020', '2020-03-14', undefined, '2019'], 'date normalisation')
  const out = jr.toJsonResume(PROFILE, { lastModified: '2026-11-02T10:00:00.000Z' })
  eq(out.basics.location, { city: 'Bengaluru', region: 'Karnataka', countryCode: 'IN' }, 'location split')
  eq(out.basics.profiles, [{ network: 'LinkedIn', username: 'asha-rao', url: 'https://www.linkedin.com/in/asha-rao' }], 'LinkedIn profile')
  ok(out.work[0].endDate === undefined && out.work[0].startDate === '2021-03', 'current job has no end date')
  eq(Object.keys(out.meta), ['version', 'lastModified'], 'meta fields')

  // Validate against the official schema (argument, or fetched).
  let schema = null
  try {
    if (inNode && process.argv[2]) schema = JSON.parse((await import('node:fs')).readFileSync(process.argv[2], 'utf8'))
    else schema = await (await fetch('https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json')).json()
  } catch {
    log('  (JSON Resume schema not available; schema validation skipped)')
  }
  if (schema) {
    const errors = []
    const check = (s, v, path) => {
      if (s.$ref) s = s.$ref.split('/').slice(1).reduce((o, k) => o[k], schema)
      const types = [].concat(s.type ?? [])
      const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
      if (types.length && !types.includes(t) && !(types.includes('integer') && Number.isInteger(v))) errors.push(`${path}: ${t} is not ${types}`)
      if (s.pattern && typeof v === 'string' && !new RegExp(s.pattern).test(v)) errors.push(`${path}: "${v}" fails ${s.pattern}`)
      if (s.format === 'uri' && typeof v === 'string' && !jr.isUrl(v)) errors.push(`${path}: "${v}" is not a URI`)
      if (s.format === 'email' && typeof v === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`${path}: "${v}" is not an email`)
      for (const r of s.required ?? []) if (v && !(r in v)) errors.push(`${path}: missing ${r}`)
      if (t === 'object' && s.properties) for (const [k, x] of Object.entries(v)) if (s.properties[k]) check(s.properties[k], x, `${path}.${k}`)
      if (t === 'array' && s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`))
    }
    check(schema, out, '$')
    eq(errors, [], 'output validates against the official JSON Resume schema')
    const unknownTop = Object.keys(out).filter((k) => !(k in schema.properties))
    eq(unknownTop, [], 'only schema top-level keys')
  }

  const back = jr.fromJsonResume(JSON.parse(JSON.stringify(out)))
  const expected = strip(PROFILE)
  // JSON Resume has no field for reference contact (joined into the reference text) or project description split.
  expected.references[0] = { name: 'K. Iyer', relation: 'Manager at Acme. k@example.com', contact: '' }
  expected.publications[0].citation = 'Rao A. Retail demand signals, 2023'
  expected.basics.location = 'Bengaluru, Karnataka, IN'
  eq(strip(back), expected, 'JSON Resume round trip')
  ok(jr.isJsonResume(out) && !jr.isJsonResume({ app: 'jivika', data: {} }), 'isJsonResume')
}

/* ---------- Europass ---------- */
section = 'europass'
{
  const out = europass.toEuropassXml(PROFILE, { id: 'test-id' })
  ok(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Candidate '), 'declaration and Candidate root')
  for (const ns of Object.values(europass.NS)) ok(out.includes(`"${ns}"`), `namespace ${ns}`)
  ok(out.includes('schemeVersionID="4.0"'), 'DocumentID version 4.0')
  ok(/<CandidatePerson><PersonName><oa:GivenName>Asha<\/oa:GivenName><hr:FamilyName>Rao<\/hr:FamilyName><\/PersonName>/.test(out), 'PersonName (mandatory)')
  ok(out.includes('<CountryDialing>91</CountryDialing><oa:DialNumber>9876543210</oa:DialNumber>'), 'telephone with CountryDialing')
  ok(out.includes('<CandidateProfile languageCode="en">'), 'profile language code')
  ok(out.includes('<Section><Title>work-experience</Title></Section>'), 'SectionsOrder')
  ok(out.includes('&lt;ul&gt;&lt;li&gt;Cut reporting time by 40%&lt;/li&gt;'), 'descriptions as escaped HTML')
  ok(out.includes('&amp;amp; fintech') && out.includes('&amp;lt;fast&amp;gt;'), 'user text double-escaped inside HTML text')
  ok(out.includes('<PrimaryLanguageCode name="NORMAL">kan</PrimaryLanguageCode>'), 'native language as mother tongue')
  ok(!/<(\w+)><\/\1>/.test(out), 'no empty elements')
  eq(europass.splitPhone('+919876543210'), { dialing: '91', number: '9876543210' }, 'phone without separator')
  eq(europass.cefr('Professional working proficiency'), 'C1', 'CEFR approximation')

  if (typeof DOMParser !== 'undefined') {
    const doc = xml.parseXmlSafe(out)
    eq(europass.europassKind(doc), 'candidate', 'kind')
    const back = strip(europass.fromEuropassDoc(doc))
    eq(back.basics.name, 'Asha Rao', 'name back')
    eq(back.basics.phone, '+91 9876543210', 'phone back')
    eq(back.experience.map((e) => [e.company, e.title, e.start, e.end, e.current, e.bullets]), PROFILE.experience.map((e) => [e.company, e.title, e.start, e.end, e.current, e.bullets]), 'experience back')
    eq(back.skills, [{ group: 'Languages', items: ['SQL', 'Python'] }, { group: 'Tools', items: ['Power BI', 'dbt'] }], 'skills back')
    eq(back.languages, [{ name: 'Kannada', level: 'Native' }, { name: 'English', level: 'C1' }], 'languages back')
    eq(back.certifications, [{ name: 'AWS Data Analytics', issuer: 'Amazon', year: '2022' }], 'certifications via custom sections')
    eq(back.projects[0].name, 'Churn model', 'projects via custom sections')
    ok(back.basics.summary.includes('retail & fintech') && back.basics.summary.includes('<fast>'), 'summary unescaped back to text')

    const legacy = `<?xml version="1.0" encoding="UTF-8"?><SkillsPassport xmlns="http://europass.cedefop.europa.eu/Europass" locale="en"><LearnerInfo><Identification><PersonName><FirstName>Jan</FirstName><Surname>Novak</Surname></PersonName><ContactInfo><Email><Contact>jan@example.com</Contact></Email></ContactInfo></Identification><WorkExperienceList><WorkExperience><Period><From year="2019" month="--04"/><Current>true</Current></Period><Position><Label>Engineer</Label></Position><Activities>Built things</Activities><Employer><Name>Skoda</Name></Employer></WorkExperience></WorkExperienceList><Skills><Linguistic><MotherTongue><Description><Label>Czech</Label></Description></MotherTongue></Linguistic></Skills></LearnerInfo></SkillsPassport>`
    const lp = europass.fromEuropassDoc(xml.parseXmlSafe(legacy))
    eq([lp.basics.name, lp.basics.email, lp.experience[0].company, lp.experience[0].start, lp.experience[0].current, lp.languages[0].name], ['Jan Novak', 'jan@example.com', 'Skoda', 'Apr 2019', true, 'Czech'], 'legacy SkillsPassport XML')
  } else log('  (no DOMParser in Node; Europass and XML parsing checks run in browser.html)')

  const lj = europass.fromLegacyEuropassJson({ SkillsPassport: { LearnerInfo: { Identification: { PersonName: { FirstName: 'Jan', Surname: 'Novak' } }, WorkExperience: [{ Period: { From: { Year: 2019, Month: '--04' } }, Position: { Label: 'Engineer' }, Employer: { Name: 'Skoda' } }] } } })
  eq([lj.basics.name, lj.experience[0].company, lj.experience[0].title, lj.experience[0].start], ['Jan Novak', 'Skoda', 'Engineer', 'Apr 2019'], 'legacy Europass JSON')
}

/* ---------- XML ---------- */
section = 'xml'
{
  eq(xml.escapeXml(`a<b>&"c"'d\u0001`), 'a&lt;b&gt;&amp;&quot;c&quot;&apos;d', 'escape and strip control characters')
  const out = xml.toGenericXml({ version: 2, exportedAt: 'now', data: { applications: [{ company: 'A & B', match: 5, ok: true, x: null }], 'coding.draft.1': 'x<y', empty: [] } })
  ok(out.includes('<applications type="array">') && out.includes('<company>A &amp; B</company>') && out.includes('<match type="number">5</match>'), 'arrays and types')
  ok(out.includes('<field name="coding.draft.1">x&lt;y</field>') === false && out.includes('<coding.draft.1>x&lt;y</coding.draft.1>'), 'dotted keys are valid names')
  const odd = xml.toGenericXml({ version: 2, exportedAt: 'now', data: { '1abc': 'v', 'a b': 'w' } })
  ok(odd.includes('<field name="1abc">v</field>') && odd.includes('<field name="a b">w</field>'), 'invalid names use field')
  await rejects(() => xml.parseXmlSafe('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), /DOCTYPE/, 'XXE rejected')
  await rejects(() => xml.parseXmlSafe('<x><!ENTITY a "b"></x>'), /DOCTYPE|entity/, 'ENTITY rejected')
  if (typeof DOMParser !== 'undefined') {
    const doc = xml.parseXmlSafe(out)
    eq(doc.documentElement.localName, 'jivika', 'generic XML is well-formed')
  }
}

/* ---------- Markdown and text ---------- */
section = 'markdown'
{
  const m = md.toMarkdown(PROFILE, { order: ['skills', 'experience'], hidden: ['references'] })
  ok(m.startsWith('# Asha Rao\n\n*Senior Data Analyst*'), 'title and headline')
  ok(m.indexOf('## Skills') < m.indexOf('## Experience') && m.indexOf('## Experience') < m.indexOf('## Projects'), 'section order respected, rest appended')
  ok(!m.includes('## References'), 'hidden section left out')
  ok(m.includes('- Cut reporting time by 40%'), 'bullets')
  const t = md.toPlainText(PROFILE)
  ok(t.includes('EXPERIENCE\n') && !t.includes('**') && !t.includes('##'), 'plain text has no markup')
}

/* ---------- LinkedIn ---------- */
section = 'linkedin'
{
  const files = {
    'Profile.csv': 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nAsha,Rao,,,,"Analyst, data",Hello,,,"Bengaluru, Karnataka, India",,[PORTFOLIO:https://asha.example.com],\n',
    'Positions.csv': 'Company Name,Title,Description,Location,Started On,Finished On\nAcme Retail,Senior Data Analyst,"Cut time\nLed team",Bengaluru,Mar 2021,\nPayCo,Data Analyst,,Pune,Jun 2018,Feb 2021\n',
    'Education.csv': 'School Name,Start Date,End Date,Notes,Degree Name,Activities\nIIT Madras,2014,2018,,B.Tech,\n',
    'Skills.csv': 'Name\nSQL\nPython\n',
    'Email Addresses.csv': 'Email Address,Confirmed,Primary,Updated On\nold@example.com,Yes,No,\nasha@example.com,Yes,Yes,\n',
    'PhoneNumbers.csv': 'Extension,Number,Type\n,+91 98765 43210,Mobile\n',
    'Languages.csv': 'Name,Proficiency\nEnglish,Full professional proficiency\n',
  }
  ok(li.isLinkedInExport(Object.keys(files)), 'detects export')
  const p = li.fromLinkedInExport(files)
  eq([p.basics.name, p.basics.headline, p.basics.email, p.basics.phone, p.basics.location, p.basics.website], ['Asha Rao', 'Analyst, data', 'asha@example.com', '+91 98765 43210', 'Bengaluru, Karnataka, India', 'https://asha.example.com'], 'basics')
  eq(p.experience.map((e) => [e.company, e.start, e.end, e.current, e.bullets]), [['Acme Retail', 'Mar 2021', '', true, ['Cut time', 'Led team']], ['PayCo', 'Jun 2018', 'Feb 2021', false, []]], 'positions')
  eq(p.skills[0].items, ['SQL', 'Python'], 'skills')
  eq(p.certifications, [], 'missing files tolerated')
}

/* ---------- Detection ---------- */
section = 'detect'
{
  const d = (name, data) => detect.detectKind(name, typeof data === 'string' ? bytes(data) : data)
  eq(d('x.txt', JSON.stringify({ app: 'jivika', version: 1, data: {} })), 'jivika-json', 'Jivika JSON, any extension')
  eq(d('resume.txt', JSON.stringify(jr.toJsonResume(PROFILE))), 'jsonresume', 'JSON Resume')
  eq(d('cv', europass.toEuropassXml(PROFILE)), 'europass-xml', 'Europass XML')
  eq(d('a.json', '{"SkillsPassport":{}}'), 'europass-json', 'legacy Europass JSON')
  eq(d('apps.txt', csv.applicationsToCsv(APPS)), 'applications-csv', 'applications CSV')
  eq(d('cal.dat', ics.buildIcs(ics.calendarEntries(APPS))), 'ics', 'calendar')
  eq(d('resume.md', '# Asha Rao\n\nAnalyst'), 'text-resume', 'Markdown resume')
  eq(d('x.bin', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'resume-file', 'PDF by magic bytes')
  eq(d('bundle', zip.writeZip([{ name: 'jivika.json', data: '{}' }])), 'jivika-zip', 'Jivika bundle')
  eq(d('export.zip', zip.writeZip([{ name: 'Positions.csv', data: '' }, { name: 'Profile.csv', data: '' }])), 'linkedin-zip', 'LinkedIn export')
  eq(d('word.zip', zip.writeZip([{ name: 'word/document.xml', data: '' }])), 'resume-file', 'DOCX')
}

/* ---------- iCalendar ---------- */
section = 'ics'
{
  const text = ics.buildIcs(ics.calendarEntries(APPS))
  const events = imp.parseIcs(text)
  const iv = events.find((e) => e.kind === 'interview')
  eq([iv.appId, iv.itemId, iv.date, iv.time, iv.duration_min, iv.notes], ['a1', 'i1', '2026-10-08', '14:30', 45, 'Bring laptop'], 'interview back with link and id')
  ok(events.some((e) => e.kind === 'followup' && e.itemId === 'f1'), 'follow-up back')
  ok(events.some((e) => e.kind === 'deadline' && e.appId === 'a2' && e.date === '2026-11-01'), 'apply-by back')
  const merged = imp.eventsIntoApplications(APPS, events.map((e) => ({ ...e, target: e.appId })), 'mine')
  eq(merged[0].interviews.length, 1, 'own calendar re-import does not duplicate interviews')
  const outside = imp.parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261110T093000Z\r\nDURATION:PT1H30M\r\nSUMMARY:Call with\r\n  Acme\\, Inc.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
  eq([outside[0].title, outside[0].duration_min], ['Call with Acme, Inc.', 90], 'folded lines, escapes and DURATION')
}

/* ---------- Merge, validation, apply and undo ---------- */
section = 'merge'
{
  const local = [{ id: '1', v: 'local' }, { id: '2', v: 'keep' }]
  const incoming = [{ id: '1', v: 'file' }, { id: '3', v: 'new' }]
  const same = (a, b) => a.id === b.id
  eq(imp.mergeList(local, incoming, same, 'mine').map((x) => x.v), ['new', 'local', 'keep'], 'keep mine')
  eq(imp.mergeList(local, incoming, same, 'file').map((x) => x.v), ['new', 'file', 'keep'], "use the file's")
  const both = imp.mergeList(local, incoming, same, 'both', (t) => ({ ...t, id: 'copy' }))
  eq(both.map((x) => [x.id, x.v]), [['copy', 'file'], ['3', 'new'], ['1', 'local'], ['2', 'keep']], 'keep both')
  ok(imp.sameApplication({ id: 'x', company: ' Acme ', role: 'Analyst' }, { id: 'y', company: 'acme', role: 'analyst' }), 'applications match by company and role')

  const mine = { ...PROFILE, basics: { ...PROFILE.basics, website: '' } }
  const file = { ...strip(PROFILE), basics: { ...PROFILE.basics, name: 'Other', website: 'https://new.example' }, experience: [{ company: 'Acme Retail', title: 'Senior Data Analyst', bullets: ['Changed'] }, { company: 'NewCo', title: 'Lead', bullets: [] }] }
  const m1 = imp.mergeProfile(mine, file, 'mine')
  eq([m1.basics.name, m1.basics.website, m1.experience.map((e) => e.company)], ['Asha Rao', 'https://new.example', ['Acme Retail', 'PayCo', 'NewCo']], 'profile merge keeps mine, fills blanks, appends new')
  const m2 = imp.mergeProfile(mine, file, 'file')
  eq([m2.basics.name, m2.experience[0].bullets, m2.experience[0].id], ['Other', ['Changed'], 'e1'], "profile merge uses the file's entry and keeps the local id")
  ok(imp.profileConflicts(mine, file) > 0, 'profile conflicts counted')

  await rejects(() => imp.validateJivika(JSON.parse('{"app":"jivika","version":2,"data":{"applications":[{"__proto__":{"x":1}}]}}')), /disallowed key/, '__proto__ rejected')
  await rejects(() => imp.validateJivika({ app: 'jivika', version: 2, data: { constructor: 1 } }), /disallowed key/, 'constructor rejected')
  await rejects(() => imp.validateJivika({ app: 'jivika', version: 99, data: {} }), /newer version/, 'newer version rejected')
  await rejects(() => imp.validateJivika({ app: 'jivika', version: 2, scope: 'emails', items: [] }), /read-only listing/, 'listings are not importable')
  const v1 = imp.validateJivika({ app: 'jivika', version: 1, data: { applications: [{ id: 'z', company: 'C', role: 'R', date: '2025-01-01', status: 'Awaiting response', link: '', notes: '' }], apikey: 'secret', keyVerified: true, mystery: 1 } })
  eq([v1.data.applications[0].status, 'apikey' in v1.data, 'keyVerified' in v1.data, v1.skipped], ['Applied', false, false, ['mystery']], 'v1 migrated, secrets dropped, unknown keys skipped')

  section = 'apply'
  localStorage.clear()
  localStorage.setItem('jivika.applications', JSON.stringify(APPS))
  localStorage.setItem('jivika.apikey', '"secret"')
  ok(snapshot.takeSnapshot('test'), 'snapshot taken')
  imp.applyApplications(csv.rowsToApplications([['Acme, Inc.', 'Analyst "II"', 'Offer'], ['NewCo', 'Lead', 'Applied']], { company: 0, role: 1, status: 2 }), 'merge', 'file')
  const after = JSON.parse(localStorage.getItem('jivika.applications'))
  eq([after.length, after.find((a) => a.company === 'Acme, Inc.').id, after.find((a) => a.company === 'Acme, Inc.').status], [3, 'a1', 'Offer'], 'CSV merge replaces by company and role, keeps id')
  imp.applyData({ applications: [] }, 'replace', 'mine')
  eq([localStorage.getItem('jivika.applications'), localStorage.getItem('jivika.apikey')], ['[]', '"secret"'], 'replace keeps the API key')
  ok(localStorage.getItem('jivika.importSnapshot') !== null, 'replace keeps the undo copy')
  ok(snapshot.undoImport(), 'undo')
  eq(JSON.parse(localStorage.getItem('jivika.applications')).length, 2, 'undo restores the data from before the import')
  ok(localStorage.getItem('jivika.importSnapshot') === null && localStorage.getItem('jivika.apikey') === '"secret"', 'undo is one level and keeps the key')
  localStorage.clear()
  const days = [{ id: 'd1', date: '2026-12-24', name: 'Leave' }]
  const rt = imp.validateJivika({ app: 'jivika', version: 2, data: { daysOff: days, holidaySettings: { country: 'IN' }, holidayImports: [], clipReceived: true, clipperPromoDismissed: true } })
  eq(rt.skipped, [], 'holiday and Clipper keys are recognised')
  imp.applyData(rt.data, 'replace', 'mine')
  eq(JSON.parse(localStorage.getItem('jivika.daysOff')), days, 'days off survive a round trip')
  localStorage.clear()
  const kind = (t) => detect.detectKind('x', new TextEncoder().encode(t))
  eq(kind('Org,Position Name,Stage\nAcme,Analyst,Applied\nPayCo,Lead,Offer\n'), 'applications-csv', 'CSV with unknown headers goes to column mapping')
  eq(kind('Asha Rao, Data Analyst\nI build dashboards and pipelines for retail teams.\n'), 'text-resume', 'prose with a comma stays resume text')
  eq(kind('<?xml version="1.0"?>\n<!DOCTYPE x [<!ENTITY e "y">]>\n<Candidate></Candidate>'), 'europass-xml', 'Europass with DOCTYPE reaches the XXE check')
}

{
  section = 'LinkedIn profile clip'
  const clip = lp.toProfileClip({
    source: 'linkedin_profile',
    clipper_version: '0.2.0',
    url: 'https://www.linkedin.com/in/sample-person/',
    basics: { name: ' Sample Person ', headline: 'Data analyst', summary: 'I build dashboards.', linkedin: 'javascript:alert(1)' },
    experience: [
      { company: 'Example Co', title: 'Analyst', start: 'Jan 2022', current: true, bullets: ['Built reports', 42, ''] },
      { company: '', title: '' },
    ],
    education: [{ school: 'Sample University', degree: 'BSc' }],
    skills: [{ items: ['SQL', 'Python'] }, { group: 'Empty', items: [] }],
    languages: ['English'],
    certifications: 'not a list',
    projects: [{ name: 'Dashboards', link: 'ftp://x' }],
    raw_text: 'x'.repeat(50000),
  })
  eq(clip.profile.basics.name, 'Sample Person', 'name trimmed')
  eq(clip.profile.basics.linkedin, 'https://www.linkedin.com/in/sample-person/', 'unsafe URL replaced by the page URL')
  eq(clip.profile.experience.map((e) => [e.title, e.current, e.bullets]), [['Analyst', true, ['Built reports', '42']]], 'empty entries dropped, bullets kept as text')
  eq([clip.profile.education[0].institution, clip.profile.skills, clip.profile.languages.map((l) => l.name)], ['Sample University', [{ group: 'Skills', items: ['SQL', 'Python'], id: clip.profile.skills[0].id }], ['English']], 'schools, skill groups and string entries')
  eq([clip.profile.certifications, clip.profile.projects[0].link, clip.raw_text.length, clip.sections], [[], '', lp.RAW_TEXT_LIMIT, 6], 'caps, bad links and section count')
  ok(clip.profile.experience[0].id, 'entries get ids')
  eq(lp.toProfileClip({ description: 'a job' }), null, 'job clips are not profiles')
  eq(lp.toProfileClip({ source: 'linkedin_profile', raw_text: 'Sample Person Analyst' }).sections, 0, 'text-only clip has no sections')
  eq(lp.reviewInput(clip), { headline: 'Data analyst', about: 'I build dashboards.', experience: 'Analyst at Example Co\nJan 2022 - Present\nBuilt reports\n42' }, 'review form')
}

log(`${passed} passed, ${failures.length} failed`)
for (const f of failures) log('FAIL ' + f)
if (inNode) process.exitCode = failures.length ? 1 : 0
else document.title = failures.length ? `FAIL ${failures.length}` : `PASS ${passed}`
