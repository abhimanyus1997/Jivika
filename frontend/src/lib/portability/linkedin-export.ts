import type { StructuredProfile } from '../api'
import { normalizeStructured } from '../store.ts'
import { parseCsv } from './csv.ts'

/* LinkedIn "Get a copy of your data" export: a ZIP of CSV files. Missing files are fine. */

export const LINKEDIN_FILES = [
  'Profile.csv',
  'Positions.csv',
  'Education.csv',
  'Skills.csv',
  'Certifications.csv',
  'Languages.csv',
  'Projects.csv',
  'Email Addresses.csv',
  'PhoneNumbers.csv',
] as const

const base = (name: string) => name.split('/').pop()!.toLowerCase()
/** True when the ZIP's file names look like a LinkedIn export. */
export const isLinkedInExport = (names: string[]) => names.some((n) => ['profile.csv', 'positions.csv'].includes(base(n)))
export const isLinkedInFile = (name: string) => LINKEDIN_FILES.some((f) => f.toLowerCase() === base(name))

/** Rows as objects keyed by header. Skips any preamble lines before the row holding `expect`. */
function records(text: string | undefined, expect: string): Record<string, string>[] {
  if (!text) return []
  const rows = parseCsv(text)
  const h = rows.findIndex((r) => r.some((c) => c.trim() === expect))
  if (h < 0) return []
  const head = rows[h].map((c) => c.trim())
  return rows.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const firstUrl = (s: string) => s.match(/https?:\/\/[^\s,\]]+/)?.[0] ?? ''

/** `files` maps file names (any folder, any case) to their text. */
export function fromLinkedInExport(files: Record<string, string>): StructuredProfile {
  const byName: Record<string, string> = {}
  for (const [n, t] of Object.entries(files)) byName[base(n)] = t
  const f = (name: string) => byName[name.toLowerCase()]

  const profile = records(f('Profile.csv'), 'First Name')[0] ?? {}
  const emails = records(f('Email Addresses.csv'), 'Email Address')
  const phones = records(f('PhoneNumbers.csv'), 'Number')
  const websites = profile['Websites'] ?? ''
  const email = emails.find((e) => /yes|true/i.test(e['Primary'] ?? '')) ?? emails[0]

  return normalizeStructured({
    basics: {
      name: [profile['First Name'], profile['Last Name']].filter(Boolean).join(' '),
      headline: profile['Headline'] ?? '',
      email: email?.['Email Address'] ?? '',
      phone: phones.find((p) => /mobile/i.test(p['Type'] ?? ''))?.['Number'] ?? phones[0]?.['Number'] ?? '',
      location: profile['Geo Location'] || profile['Address'] || '',
      linkedin: '',
      website: firstUrl(websites),
      summary: profile['Summary'] ?? '',
    },
    experience: records(f('Positions.csv'), 'Company Name').map((p) => ({
      id: '',
      company: p['Company Name'] ?? '',
      title: p['Title'] ?? '',
      location: p['Location'] ?? '',
      start: p['Started On'] ?? '',
      end: p['Finished On'] ?? '',
      current: !p['Finished On'],
      bullets: (p['Description'] ?? '').split(/\r?\n/).map((s) => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean),
    })),
    education: records(f('Education.csv'), 'School Name').map((e) => ({
      id: '',
      institution: e['School Name'] ?? '',
      degree: e['Degree Name'] ?? '',
      field: '',
      start: e['Start Date'] ?? '',
      end: e['End Date'] ?? '',
      grade: '',
    })),
    skills: (() => {
      const items = records(f('Skills.csv'), 'Name').map((s) => s['Name']).filter(Boolean)
      return items.length ? [{ group: '', items }] : []
    })(),
    languages: records(f('Languages.csv'), 'Name').map((l) => ({ name: l['Name'] ?? '', level: l['Proficiency'] ?? '' })),
    projects: records(f('Projects.csv'), 'Title').map((p) => ({
      id: '',
      name: p['Title'] ?? '',
      role: '',
      link: p['Url'] ?? '',
      description: p['Description'] ?? '',
      bullets: [],
    })),
    certifications: records(f('Certifications.csv'), 'Name').map((c) => ({
      id: '',
      name: c['Name'] ?? '',
      issuer: c['Authority'] ?? '',
      year: (c['Started On'] ?? '').match(/\b(19|20)\d{2}\b/)?.[0] ?? '',
    })),
    publications: [],
    references: [],
  })
}
