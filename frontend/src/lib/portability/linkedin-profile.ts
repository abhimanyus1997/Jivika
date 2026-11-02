import type { StructuredProfile } from '../api'
import { normalizeStructured } from '../store.ts'

/* A LinkedIn profile clipped by Jivika Clipper (source 'linkedin_profile'). The payload is untrusted: every value is capped plain text. */

export const RAW_TEXT_LIMIT = 40000
const LIST_LIMIT = 100

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '')
const url = (v: unknown) => {
  const s = str(v, 500)
  return /^https?:\/\//i.test(s) ? s : ''
}
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, LIST_LIMIT) : [])
const texts = (v: unknown, max = 2000) => list(v).map((x) => str(x, max)).filter(Boolean)
/** Entries may arrive as strings or objects; a string fills `key`. */
const entries = (v: unknown, key: string) => list(v).map((x) => (typeof x === 'string' ? { [key]: x } : obj(x)))

export interface ProfileClip {
  profile: StructuredProfile
  raw_text: string
  /** Sections with at least one entry (About counts). Fewer than 2 means the page was not read well. */
  sections: number
}

export function isProfileClip(data: unknown) {
  return obj(data).source === 'linkedin_profile'
}

export function toProfileClip(data: unknown): ProfileClip | null {
  if (!isProfileClip(data)) return null
  const d = obj(data)
  const b = obj(d.basics)
  const profile = normalizeStructured({
    basics: {
      name: str(b.name),
      headline: str(b.headline, 500),
      location: str(b.location),
      summary: str(b.summary, 5000),
      linkedin: url(b.linkedin) || url(d.url),
      email: '',
      phone: '',
      website: '',
    },
    experience: entries(d.experience, 'title').map((e) => ({
      id: '',
      company: str(e.company),
      title: str(e.title),
      location: str(e.location),
      start: str(e.start, 40),
      end: str(e.end, 40),
      current: e.current === true,
      bullets: texts(e.bullets),
    })),
    education: entries(d.education, 'institution').map((e) => ({
      id: '',
      institution: str(e.institution) || str(e.school),
      degree: str(e.degree),
      field: str(e.field),
      start: str(e.start, 40),
      end: str(e.end, 40),
      grade: str(e.grade, 100),
    })),
    skills: entries(d.skills, 'group')
      .map((g) => ({ group: str(g.group) || 'Skills', items: texts(g.items, 200) }))
      .filter((g) => g.items.length),
    languages: entries(d.languages, 'name').map((l) => ({ name: str(l.name), level: str(l.level) })),
    certifications: entries(d.certifications, 'name').map((c) => ({ id: '', name: str(c.name), issuer: str(c.issuer), year: str(c.year, 40) })),
    projects: entries(d.projects, 'name').map((p) => ({
      id: '',
      name: str(p.name),
      role: str(p.role),
      link: url(p.link),
      description: str(p.description, 5000),
      bullets: texts(p.bullets),
    })),
    publications: entries(d.publications, 'citation').map((p) => ({ id: '', citation: str(p.citation, 1000) || str(p.title, 1000) })),
  })
  // Drop entries that came through empty.
  profile.experience = profile.experience.filter((e) => e.title || e.company)
  profile.education = profile.education.filter((e) => e.institution || e.degree)
  profile.languages = profile.languages.filter((l) => l.name)
  profile.certifications = profile.certifications.filter((c) => c.name)
  profile.projects = profile.projects.filter((p) => p.name)
  profile.publications = profile.publications.filter((p) => p.citation)
  const lists = [profile.experience, profile.education, profile.skills, profile.languages, profile.certifications, profile.projects, profile.publications]
  const sections = lists.filter((l) => l.length).length + (profile.basics.summary ? 1 : 0)
  const raw_text = str(d.raw_text, RAW_TEXT_LIMIT)
  if (!sections && !raw_text && !profile.basics.name) return null
  return { profile, raw_text, sections }
}

/** The LinkedIn review form, filled from a profile clip. */
export function reviewInput(clip: ProfileClip) {
  const { basics, experience } = clip.profile
  const roles = experience.slice(0, 6).map((e) =>
    [[e.title, e.company].filter(Boolean).join(' at '), [e.start, e.current ? 'Present' : e.end].filter(Boolean).join(' - '), ...e.bullets].filter(Boolean).join('\n'),
  )
  return { headline: basics.headline, about: basics.summary, experience: roles.join('\n\n').slice(0, 8000) }
}
