import type { StructuredProfile } from '../api'
import { normalizeStructured } from '../store.ts'

/* JSON Resume (https://jsonresume.org/schema, v1.0.0) to and from the structured profile. */

export const JSON_RESUME_SCHEMA = 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** Free-text date ('Mar 2020', '03/2020', '2020-03-14', 'Summer 2019') to the schema's YYYY[-MM[-DD]]. Undefined for 'Present' or unreadable text. */
export function toIsoDate(s: string | undefined): string | undefined {
  const t = (s ?? '').trim().toLowerCase()
  if (!t || /present|current|now|ongoing|today/.test(t)) return undefined
  let m = t.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/)
  if (m) return [m[1], m[2] && pad(+m[2]), m[2] && m[3] && pad(+m[3])].filter(Boolean).join('-')
  m = t.match(/^(\d{1,2})[/.-](\d{4})$/)
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`
  m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/)
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${pad(MONTHS.indexOf(m[1]) + 1)}`
  m = t.match(/\b(19|20)\d{2}\b/)
  return m ? m[0] : undefined
}

/** YYYY-MM to 'Mar 2020' (the way dates are typed in the profile editor); other values unchanged. */
export function fromIsoDate(s: unknown): string {
  const t = typeof s === 'string' ? s.trim() : ''
  const m = t.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!m || +m[2] < 1 || +m[2] > 12) return t
  const mon = MONTHS[+m[2] - 1]
  return `${mon[0].toUpperCase()}${mon.slice(1)} ${m[1]}`
}

export const isUrl = (s: string) => {
  try {
    return /^https?:$/.test(new URL(s).protocol)
  } catch {
    return false
  }
}
/** Bare domains ('github.com/me') get https:// so they pass the schema's uri format. */
export const asUrl = (s: string | undefined) => {
  const t = (s ?? '').trim()
  if (!t) return undefined
  const u = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  return isUrl(u) ? u : undefined
}
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

/** Drops empty strings, empty arrays and undefined so the output stays tidy. */
function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v
  return out as Partial<T>
}

function splitLocation(loc: string) {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return undefined
  const last = parts[parts.length - 1]
  const countryCode = parts.length > 1 && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : undefined
  const rest = countryCode ? parts.slice(0, -1) : parts
  return clean({ city: rest[0], region: rest.slice(1).join(', ') || undefined, countryCode })
}

const linkedinUser = (url: string) => url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]

export function toJsonResume(sp: StructuredProfile, opts: { lastModified?: string; canonical?: string } = {}) {
  const p = normalizeStructured(sp)
  const b = p.basics
  const linkedin = asUrl(b.linkedin)
  return {
    $schema: JSON_RESUME_SCHEMA,
    basics: clean({
      name: b.name,
      label: b.headline,
      email: isEmail(b.email.trim()) ? b.email.trim() : undefined,
      phone: b.phone,
      url: asUrl(b.website),
      summary: b.summary,
      location: splitLocation(b.location),
      profiles: linkedin ? [clean({ network: 'LinkedIn', username: linkedinUser(linkedin), url: linkedin })] : [],
    }),
    work: p.experience.map((e) =>
      clean({ name: e.company, position: e.title, location: e.location, startDate: toIsoDate(e.start), endDate: e.current ? undefined : toIsoDate(e.end), highlights: e.bullets.filter(Boolean) }),
    ),
    education: p.education.map((e) =>
      clean({ institution: e.institution, area: e.field, studyType: e.degree, startDate: toIsoDate(e.start), endDate: toIsoDate(e.end), score: e.grade }),
    ),
    skills: p.skills.map((g) => clean({ name: g.group, keywords: g.items.filter(Boolean) })),
    languages: p.languages.map((l) => clean({ language: l.name, fluency: l.level })),
    projects: p.projects.map((x) => clean({ name: x.name, description: x.description, highlights: x.bullets.filter(Boolean), url: asUrl(x.link), roles: x.role ? [x.role] : [] })),
    certificates: p.certifications.map((c) => clean({ name: c.name, issuer: c.issuer, date: toIsoDate(c.year) })),
    publications: p.publications.map((x) => clean({ name: x.citation })),
    references: p.references.map((r) => clean({ name: r.name, reference: [r.relation, r.contact].filter(Boolean).join('. ') })),
    meta: clean({ canonical: opts.canonical ? asUrl(opts.canonical) : undefined, version: 'v1.0.0', lastModified: opts.lastModified ?? new Date().toISOString() }),
  }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/** True for an object shaped like a JSON Resume (basics or work, and no Jivika marker). */
export function isJsonResume(v: unknown): boolean {
  const o = obj(v)
  if (o.app === 'jivika') return false
  return (!!o.basics && typeof o.basics === 'object') || Array.isArray(o.work) || (typeof o.$schema === 'string' && o.$schema.includes('jsonresume'))
}

export function fromJsonResume(v: unknown): StructuredProfile {
  const r = obj(v)
  const b = obj(r.basics)
  const loc = obj(b.location)
  const profiles = list(b.profiles)
  const linkedin = profiles.find((p) => /linkedin/i.test(str(p.network)) || /linkedin\.com/i.test(str(p.url)))
  return normalizeStructured({
    basics: {
      name: str(b.name),
      headline: str(b.label),
      email: str(b.email),
      phone: str(b.phone),
      location: [str(loc.address).split('\n')[0], str(loc.city), str(loc.region), str(loc.countryCode)].filter(Boolean).join(', '),
      linkedin: str(linkedin?.url) || (linkedin && str(linkedin.username) ? `https://www.linkedin.com/in/${str(linkedin.username)}` : ''),
      website: str(b.url) || str(b.website) || str(profiles.find((p) => p !== linkedin)?.url),
      summary: str(b.summary),
    },
    experience: list(r.work).map((w) => ({
      id: '',
      company: str(w.name) || str(w.company),
      title: str(w.position),
      location: str(w.location),
      start: fromIsoDate(w.startDate),
      end: fromIsoDate(w.endDate),
      current: !str(w.endDate),
      bullets: [...(str(w.summary) ? [str(w.summary)] : []), ...strs(w.highlights)],
    })),
    education: list(r.education).map((e) => ({
      id: '',
      institution: str(e.institution),
      degree: str(e.studyType),
      field: str(e.area),
      start: fromIsoDate(e.startDate),
      end: fromIsoDate(e.endDate),
      grade: str(e.score) || str(e.gpa),
    })),
    // Skills with keywords become named groups; single skills without keywords are gathered into one unnamed group.
    skills: [
      ...list(r.skills).filter((s) => strs(s.keywords).length).map((s) => ({ group: str(s.name), items: strs(s.keywords) })),
      ...(list(r.skills).some((s) => !strs(s.keywords).length && str(s.name))
        ? [{ group: '', items: list(r.skills).filter((s) => !strs(s.keywords).length).map((s) => str(s.name)).filter(Boolean) }]
        : []),
    ],
    languages: list(r.languages).map((l) => ({ name: str(l.language), level: str(l.fluency) })),
    projects: list(r.projects).map((x) => ({
      id: '',
      name: str(x.name),
      role: strs(x.roles).join(', '),
      link: str(x.url),
      description: str(x.description),
      bullets: strs(x.highlights),
    })),
    certifications: list(r.certificates).map((c) => ({ id: '', name: str(c.name), issuer: str(c.issuer), year: str(c.date).slice(0, 4) })),
    publications: list(r.publications).map((x) => ({ id: '', citation: [str(x.name), str(x.publisher), str(x.releaseDate).slice(0, 4)].filter(Boolean).join(', ') })),
    references: list(r.references).map((x) => ({ id: '', name: str(x.name), relation: str(x.reference), contact: '' })),
  })
}
