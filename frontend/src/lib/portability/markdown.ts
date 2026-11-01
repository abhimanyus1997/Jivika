import type { StructuredProfile } from '../api'
import { normalizeStructured, SECTION_KEYS, type SectionKey } from '../store.ts'

/* Markdown and plain-text resumes from the structured profile, in the resume's section order. */

const TITLES: Record<SectionKey, string> = {
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
  publications: 'Publications',
  references: 'References',
}

interface Layout {
  order?: readonly SectionKey[]
  hidden?: string[]
}

const range = (start: string, end: string, current?: boolean) => [start, current ? 'Present' : end].filter(Boolean).join(' - ')
const join = (sep: string, ...parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(sep)

/** One block per section: a heading and its lines, already formatted for the target. */
function blocks(sp: StructuredProfile, layout: Layout, md: boolean): { title: string; lines: string[] }[] {
  const p = normalizeStructured(sp)
  const bullet = (s: string) => (md ? `- ${s}` : `  - ${s}`)
  const strong = (s: string) => (md && s ? `**${s}**` : s)
  const sections: Record<SectionKey, string[]> = {
    experience: p.experience.flatMap((e) => [join(', ', strong(join(', ', e.title, e.company)), e.location, range(e.start, e.end, e.current)), ...e.bullets.filter(Boolean).map(bullet), '']),
    projects: p.projects.flatMap((x) => [join(', ', strong(x.name), x.role, x.link), ...[x.description, ...x.bullets].filter(Boolean).map(bullet), '']),
    education: p.education.flatMap((e) => [join(', ', strong(join(', ', e.degree, e.field)), e.institution, range(e.start, e.end), e.grade), '']),
    skills: p.skills.filter((g) => g.items.length).map((g) => (g.group ? `${strong(g.group + ':')} ${g.items.join(', ')}` : g.items.join(', '))),
    languages: p.languages.filter((l) => l.name).map((l) => join(': ', l.name, l.level)),
    certifications: p.certifications.map((c) => bullet(join(', ', c.name, c.issuer, c.year))),
    publications: p.publications.filter((x) => x.citation).map((x) => bullet(x.citation)),
    references: p.references.map((r) => bullet(join(', ', r.name, r.relation, r.contact))),
  }
  const hidden = new Set(layout.hidden ?? [])
  const order = [...(layout.order ?? SECTION_KEYS), ...SECTION_KEYS.filter((k) => !(layout.order ?? SECTION_KEYS).includes(k))]
  const out = !hidden.has('summary') && p.basics.summary.trim() ? [{ title: 'Summary', lines: [p.basics.summary.trim()] }] : []
  for (const k of order) {
    if (hidden.has(k)) continue
    const lines = sections[k]
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    if (lines.length) out.push({ title: TITLES[k], lines })
  }
  return out
}

function contact(sp: StructuredProfile) {
  const b = normalizeStructured(sp).basics
  return join(' | ', b.email, b.phone, b.location, b.linkedin, b.website)
}

export function toMarkdown(sp: StructuredProfile, layout: Layout = {}): string {
  const b = normalizeStructured(sp).basics
  const head = [`# ${b.name || 'Resume'}`, b.headline && `*${b.headline}*`, contact(sp)].filter(Boolean).join('\n\n')
  return [head, ...blocks(sp, layout, true).map((s) => `## ${s.title}\n\n${s.lines.join('\n')}`)].join('\n\n') + '\n'
}

export function toPlainText(sp: StructuredProfile, layout: Layout = {}): string {
  const b = normalizeStructured(sp).basics
  const head = [b.name || 'Resume', b.headline, contact(sp)].filter(Boolean).join('\n')
  return [head, ...blocks(sp, layout, false).map((s) => `${s.title.toUpperCase()}\n${s.lines.join('\n')}`)].join('\n\n') + '\n'
}
