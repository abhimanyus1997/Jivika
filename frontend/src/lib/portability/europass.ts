import type { StructuredProfile } from '../api'
import { normalizeStructured } from '../store.ts'
import { asUrl, fromIsoDate, toIsoDate } from './jsonresume.ts'
import { escapeXml, kid, kids, textAt } from './xml.ts'

/*
 * Europass CV as the current Europass editor (europass.europa.eu, since 2020) imports and exports it:
 * the "Candidate" XML document (HR Open Standards based, namespace http://www.europass.eu/1.0, document
 * schemeVersionID 4.0). The editor's PDFs embed the same XML. Import also reads the legacy
 * Europass CV v3 "SkillsPassport" XML and JSON from the former Cedefop site.
 */

export const NS = {
  europass: 'http://www.europass.eu/1.0',
  oa: 'http://www.openapplications.org/oagis/9',
  eures: 'http://www.europass_eures.eu/1.0',
  hr: 'http://www.hr-xml.org/3',
}

type Child = string | null | undefined | false
/** Element with escaped text, or with already-built children when `body` is an array. Empty elements are dropped. */
function el(name: string, body: string | Child[], attrs: Record<string, string> = {}): string {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('')
  if (Array.isArray(body)) {
    const inner = body.filter(Boolean).join('')
    return inner ? `<${name}${a}>${inner}</${name}>` : ''
  }
  return body.trim() ? `<${name}${a}>${escapeXml(body.trim())}</${name}>` : ''
}

/** Long texts hold HTML stored as escaped text; plain text is wrapped in paragraphs or a list. */
const htmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paragraphs = (s: string) => s.split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${htmlEsc(p)}</p>`).join('')
const bulletsHtml = (items: string[]) => (items.length ? `<ul>${items.map((b) => `<li>${htmlEsc(b)}</li>`).join('')}</ul>` : '')
const date = (s: string) => {
  const d = toIsoDate(s)
  return d ? el('hr:FormattedDateTime', d) : ''
}

const LANG_CODES: Record<string, string> = {
  english: 'eng', hindi: 'hin', french: 'fra', german: 'deu', spanish: 'spa', italian: 'ita', portuguese: 'por', dutch: 'nld', russian: 'rus',
  arabic: 'ara', chinese: 'zho', mandarin: 'zho', japanese: 'jpn', korean: 'kor', bengali: 'ben', tamil: 'tam', telugu: 'tel', marathi: 'mar',
  kannada: 'kan', malayalam: 'mal', gujarati: 'guj', punjabi: 'pan', urdu: 'urd', odia: 'ori', sanskrit: 'san', polish: 'pol', swedish: 'swe',
}
const CODE_NAMES = Object.fromEntries(Object.entries(LANG_CODES).map(([n, c]) => [c, n[0].toUpperCase() + n.slice(1)]))
const DIMENSIONS = ['CEF-Understanding-Listening', 'CEF-Understanding-Reading', 'CEF-Speaking-Interaction', 'CEF-Speaking-Production', 'CEF-Writing-Production']

/** CEFR level for a free-text level. ponytail: word levels are approximations; exact levels pass through. */
export function cefr(level: string): string {
  const l = level.trim().toLowerCase()
  const exact = l.match(/\b([abc][12])\b/)
  if (exact) return exact[1].toUpperCase()
  if (/native|mother|bilingual/.test(l)) return 'C2'
  if (/fluent|proficient|advanced|professional|full/.test(l)) return 'C1'
  if (/upper/.test(l)) return 'B2'
  if (/intermediate|conversational|working|limited/.test(l)) return 'B1'
  if (/basic|elementary|beginner/.test(l)) return 'A2'
  return ''
}
const isNative = (level: string) => /native|mother/i.test(level)

const COMMON_DIALING = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '41', '44', '46', '47', '49', '61', '65', '81', '82', '86', '91', '92', '94', '971', '974', '977', '880']
/** Splits '+91 98765 43210' into dialing code and number; undefined when there is no recognisable international prefix. */
export function splitPhone(phone: string): { dialing: string; number: string } | undefined {
  const t = phone.trim()
  const sep = t.match(/^\+(\d{1,3})[\s().-]+(.+)$/)
  if (sep) return { dialing: sep[1], number: sep[2].replace(/\D/g, '') }
  const bare = t.match(/^\+(\d+)$/)?.[1] ?? t.replace(/[\s().-]/g, '').match(/^\+(\d+)$/)?.[1]
  if (!bare) return undefined
  const code = [...COMMON_DIALING].sort((a, b) => b.length - a.length).find((c) => bare.startsWith(c))
  return code ? { dialing: code, number: bare.slice(code.length) } : undefined
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { given: parts[0] ?? '', family: parts[0] ?? '' }
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] }
}

const other = (section: string, title: string, description: string, link?: string) =>
  el('Others', [el('Title', section), el('Other', [el('Title', title || section), el('Description', paragraphs(description)), link ? el('Link', link) : ''])])

/** Europass Candidate XML for the profile. */
export function toEuropassXml(sp: StructuredProfile, opts: { id?: string; language?: string } = {}): string {
  const p = normalizeStructured(sp)
  const b = p.basics
  const { given, family } = splitName(b.name || 'Name')
  const personName = el('PersonName', [el('oa:GivenName', given), el('hr:FamilyName', family)])
  const email = b.email.trim() ? el('Communication', [el('ChannelCode', 'Email'), el('oa:URI', b.email)]) : ''
  const phone = splitPhone(b.phone)
  const linkedin = asUrl(b.linkedin)
  const website = asUrl(b.website)
  const city = b.location.split(',')[0]?.trim() ?? ''
  const id = opts.id ?? crypto.randomUUID()
  const scheme = { schemeID: 'Jivika', schemeAgencyName: 'EUROPASS', schemeVersionID: '1.0' }

  const seen = new Set<string>()
  const distinct = (items: string[]) => items.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
  const competency = (name: string) => el('PersonCompetency', [el('hr:TaxonomyID', 'Digital_Skill'), el('hr:CompetencyName', name)])
  const skills = p.skills.map((g) => {
    const items = distinct(g.items).map(competency)
    return g.group.trim() ? (items.length ? el('SkillsGroup', [el('Title', g.group), ...items]) : '') : items.join('')
  })

  const foreign = p.languages.filter((l) => l.name.trim() && !isNative(l.level))
  const sections = [
    p.experience.length && 'work-experience',
    p.education.length && 'education-training',
    foreign.length && 'language',
    p.skills.some((g) => g.items.length) && 'profile-skills',
    p.publications.length && 'publication',
  ].filter(Boolean) as string[]

  const body = el(
    'Candidate',
    [
      `<hr:DocumentID schemeID="${escapeXml(id)}" schemeName="DocumentIdentifier" schemeAgencyName="EUROPASS" schemeVersionID="4.0"/>`,
      el('CandidateSupplier', [
        `<hr:PartyID schemeID="${escapeXml(id)}" schemeName="PartyID" schemeAgencyName="EUROPASS" schemeVersionID="1.0"/>`,
        el('hr:PartyName', 'Owner'),
        el('PersonContact', [personName, email]),
        el('hr:PrecedenceCode', '1'),
      ]),
      el('CandidatePerson', [
        personName,
        email,
        phone && el('Communication', [el('ChannelCode', 'Telephone'), el('UseCode', 'mobile'), el('CountryDialing', phone.dialing), el('oa:DialNumber', phone.number)]),
        linkedin && el('Communication', [el('ChannelCode', 'Social Media'), el('UseCode', 'linkedin'), el('oa:URI', linkedin)]),
        website && el('Communication', [el('ChannelCode', 'Web'), el('oa:URI', website)]),
        city && el('Communication', [el('UseCode', 'home'), el('Address', [el('oa:AddressLine', b.location), el('oa:CityName', city)], { type: 'home' })]),
        ...p.languages.filter((l) => l.name.trim() && isNative(l.level)).map((l) => {
          const code = LANG_CODES[l.name.trim().toLowerCase()]
          return el('PrimaryLanguageCode', code ?? l.name, { name: code ? 'NORMAL' : 'FREE_TEXT' })
        }),
      ]),
      el(
        'CandidateProfile',
        [
          el('hr:ID', id, { ...scheme, schemeName: 'CandidateProfileID' }),
          el('hr:ExecutiveSummary', paragraphs([b.headline, b.summary].filter(Boolean).join('\n\n'))),
          el(
            'EmploymentHistory',
            p.experience.map((e) =>
              el('EmployerHistory', [
                el('hr:OrganizationName', e.company || 'Employer'),
                el('PositionHistory', [
                  el('PositionTitle', e.title || 'Role', { typeCode: 'FREETEXT' }),
                  el('eures:EmploymentPeriod', [
                    el('eures:StartDate', [date(e.start)]),
                    !e.current && el('eures:EndDate', [date(e.end)]),
                    el('hr:CurrentIndicator', String(!!e.current)),
                  ]),
                  el('oa:Description', bulletsHtml(e.bullets.filter(Boolean))),
                  el('City', e.location.split(',')[0] ?? ''),
                ]),
              ]),
            ),
          ),
          el(
            'EducationHistory',
            p.education.map((e) =>
              el('EducationOrganizationAttendance', [
                el('hr:OrganizationName', e.institution || 'Institution'),
                el('AttendancePeriod', [el('StartDate', [date(e.start)]), el('EndDate', [date(e.end)]), el('Ongoing', 'false')]),
                el('EducationDegree', [
                  el('hr:DegreeName', [e.degree, e.field].filter(Boolean).join(', ') || 'Qualification'),
                  e.field && el('OccupationalSkillsCovered', paragraphs(e.field)),
                  e.grade && el('FinalGrade', [el('hr:ScoreText', e.grade)]),
                ]),
              ]),
            ),
          ),
          el('PublicationHistory', p.publications.filter((x) => x.citation.trim()).map((x) => el('Publication', [el('hr:FormattedPublicationDescription', paragraphs(x.citation)), el('Title', x.citation)]))),
          el(
            'PersonQualifications',
            foreign.map((l) => {
              const code = LANG_CODES[l.name.trim().toLowerCase()]
              const level = cefr(l.level)
              return el('PersonCompetency', [
                el('CompetencyID', code ?? l.name, { schemeName: code ? 'NORMAL' : 'FREE_TEXT' }),
                el('hr:TaxonomyID', 'language'),
                ...(level ? DIMENSIONS.map((d) => el('eures:CompetencyDimension', [el('hr:CompetencyDimensionTypeCode', d), el('eures:Score', [el('hr:ScoreText', level)])])) : []),
              ])
            }),
          ),
          el('Skills', skills),
          ...p.projects.map((x) => other('Projects', x.name, [x.role, x.description, ...x.bullets].filter(Boolean).join('\n'), asUrl(x.link))),
          ...p.certifications.map((c) => other('Certifications', c.name, [c.issuer, c.year].filter(Boolean).join(', '))),
          ...p.references.map((r) => other('References', r.name, [r.relation, r.contact].filter(Boolean).join('\n'))),
        ],
        { languageCode: opts.language ?? 'en' },
      ),
      el('RenderingInformation', [
        el('Design', [
          el('Template', 'Template1'),
          el('Color', 'Default'),
          el('FontSize', 'Medium'),
          el('Logo', 'FirstPage'),
          el('PageNumbers', 'true'),
          el('SectionsOrder', sections.map((s) => el('Section', [el('Title', s)]))),
        ]),
      ]),
    ],
    {
      'xsi:schemaLocation': `${NS.europass} Candidate.xsd`,
      xmlns: NS.europass,
      'xmlns:oa': NS.oa,
      'xmlns:eures': NS.eures,
      'xmlns:hr': NS.hr,
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    },
  )
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}\n`
}

/* ---------- Import ---------- */

/** Escaped HTML in long texts to plain lines. */
function htmlToLines(s: string): string[] {
  const t = s
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return t.split('\n').map((x) => x.trim()).filter(Boolean)
}

export type EuropassKind = 'candidate' | 'legacy'
export function europassKind(doc: Document): EuropassKind | null {
  const root = doc.documentElement?.localName
  return root === 'Candidate' ? 'candidate' : root === 'SkillsPassport' ? 'legacy' : null
}

export function fromEuropassDoc(doc: Document): StructuredProfile {
  const root = doc.documentElement
  if (root.localName === 'SkillsPassport') return fromLegacyXml(root)
  if (root.localName !== 'Candidate') throw new Error('This XML file is not a Europass CV.')
  const person = kid(root, 'CandidatePerson')
  const profile = kid(root, 'CandidateProfile')
  const comms = kids(person, 'Communication')
  const channel = (code: string, use?: string) => comms.find((c) => textAt(c, 'ChannelCode') === code && (!use || textAt(c, 'UseCode') === use))
  const tel = channel('Telephone')
  const address = comms.map((c) => kid(c, 'Address')).find(Boolean)
  const summary = htmlToLines(textAt(profile, 'ExecutiveSummary'))
  const native = kids(person, 'PrimaryLanguageCode').map((l) => {
    const v = l.textContent?.trim() ?? ''
    return { name: l.getAttribute('name') === 'NORMAL' ? (CODE_NAMES[v] ?? v) : v, level: 'Native' }
  })
  const competencyName = (c: Element) => textAt(c, 'CompetencyName')
  const skillsEl = kid(profile, 'Skills')
  const loose = kids(skillsEl, 'PersonCompetency').map(competencyName).filter(Boolean)
  const others = kids(profile, 'Others').map((o) => {
    const entry = kid(o, 'Other')
    return { section: textAt(o, 'Title'), title: textAt(entry, 'Title'), lines: htmlToLines(textAt(entry, 'Description')), link: textAt(entry, 'Link') }
  })
  const inSection = (re: RegExp) => others.filter((o) => re.test(o.section))

  return normalizeStructured({
    basics: {
      name: [textAt(person, 'PersonName', 'GivenName'), textAt(person, 'PersonName', 'FamilyName')].filter(Boolean).join(' '),
      headline: '',
      email: textAt(channel('Email'), 'URI'),
      phone: tel ? `+${textAt(tel, 'CountryDialing')} ${textAt(tel, 'DialNumber')}`.trim() : '',
      location: textAt(address, 'AddressLine') || [textAt(address, 'CityName'), textAt(address, 'CountryCode').toUpperCase()].filter(Boolean).join(', '),
      linkedin: textAt(channel('Social Media', 'linkedin'), 'URI'),
      website: textAt(channel('Web'), 'URI'),
      summary: summary.join('\n'),
    },
    experience: kids(kid(profile, 'EmploymentHistory'), 'EmployerHistory').flatMap((h) =>
      kids(h, 'PositionHistory').map((pos) => {
        const period = kid(pos, 'EmploymentPeriod')
        return {
          id: '',
          company: textAt(h, 'OrganizationName'),
          title: textAt(pos, 'PositionTitle'),
          location: textAt(pos, 'City') || textAt(h, 'OrganizationContact', 'Communication', 'Address', 'CityName'),
          start: fromIsoDate(textAt(period, 'StartDate', 'FormattedDateTime')),
          end: fromIsoDate(textAt(period, 'EndDate', 'FormattedDateTime')),
          current: textAt(period, 'CurrentIndicator') === 'true',
          bullets: htmlToLines(textAt(pos, 'Description')),
        }
      }),
    ),
    education: kids(kid(profile, 'EducationHistory'), 'EducationOrganizationAttendance').map((e) => ({
      id: '',
      institution: textAt(e, 'OrganizationName'),
      degree: textAt(e, 'EducationDegree', 'DegreeName'),
      field: '',
      start: fromIsoDate(textAt(e, 'AttendancePeriod', 'StartDate', 'FormattedDateTime')),
      end: fromIsoDate(textAt(e, 'AttendancePeriod', 'EndDate', 'FormattedDateTime')),
      grade: textAt(e, 'EducationDegree', 'FinalGrade', 'ScoreText'),
    })),
    skills: [
      ...(loose.length ? [{ group: '', items: loose }] : []),
      ...kids(skillsEl, 'SkillsGroup').map((g) => ({ group: textAt(g, 'Title'), items: kids(g, 'PersonCompetency').map(competencyName).filter(Boolean) })),
    ],
    languages: [
      ...native,
      ...kids(kid(profile, 'PersonQualifications'), 'PersonCompetency')
        .filter((c) => textAt(c, 'TaxonomyID') === 'language')
        .map((c) => {
          const idEl = kid(c, 'CompetencyID')
          const v = idEl?.textContent?.trim() ?? ''
          const levels = kids(c, 'CompetencyDimension').map((d) => textAt(d, 'Score', 'ScoreText')).filter(Boolean)
          return { name: idEl?.getAttribute('schemeName') === 'NORMAL' ? (CODE_NAMES[v] ?? v) : v, level: levels.sort().reverse()[0] ?? '' }
        }),
    ],
    projects: inSection(/project/i).map((o) => ({ id: '', name: o.title, role: '', link: o.link, description: o.lines[0] ?? '', bullets: o.lines.slice(1) })),
    certifications: inSection(/certif/i).map((o) => ({ id: '', name: o.title, issuer: o.lines.join(', ').replace(/,?\s*\b(19|20)\d{2}$/, ''), year: o.lines.join(' ').match(/\b(19|20)\d{2}\b/)?.[0] ?? '' })),
    publications: kids(kid(profile, 'PublicationHistory'), 'Publication').map((x) => ({
      id: '',
      citation: textAt(x, 'Title') || htmlToLines(textAt(x, 'FormattedPublicationDescription')).join(' '),
    })),
    references: inSection(/reference|recommend/i).map((o) => ({ id: '', name: o.title, relation: o.lines[0] ?? '', contact: o.lines.slice(1).join(', ') })),
  })
}

/* Legacy Europass CV v3 (SkillsPassport) in XML or JSON. Both share the same structure, read through one accessor. */

type Legacy = { get: (...path: string[]) => Legacy; all: (name: string) => Legacy[]; text: () => string; attr: (n: string) => string }

function xmlLegacy(e: Element | null): Legacy {
  return {
    get: (...path) => xmlLegacy(path.reduce<Element | null>((c, p) => kid(c, p), e)),
    all: (name) => kids(e, name).map(xmlLegacy),
    text: () => e?.textContent?.trim() ?? '',
    attr: (n) => e?.getAttribute(n) ?? '',
  }
}
function jsonLegacy(v: unknown): Legacy {
  const asObj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined)
  const o = asObj(v)
  const scalar = (x: unknown) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? String(x).trim() : '')
  return {
    // JSON has no list wrappers (WorkExperienceList holds an array named WorkExperience), so a missing *List key is skipped.
    get: (...path) => jsonLegacy(path.reduce<unknown>((c, p) => asObj(c)?.[p] ?? (p.endsWith('List') ? c : undefined), v)),
    all: (name) => {
      const x = o?.[name]
      return Array.isArray(x) ? x.map(jsonLegacy) : x ? [jsonLegacy(x)] : []
    },
    text: () => scalar(v),
    attr: (n) => scalar(o?.[n.charAt(0).toUpperCase() + n.slice(1)] ?? o?.[n]),
  }
}

function legacyDate(d: Legacy): string {
  const year = d.attr('year').replace(/\D/g, '') || d.get('Year').text()
  const month = (d.attr('month').replace(/\D/g, '') || d.get('Month').text().replace(/\D/g, '')).padStart(2, '0')
  return year ? fromIsoDate(month !== '00' ? `${year}-${month}` : year) : ''
}

function fromLegacy(r: Legacy): StructuredProfile {
  const info = r.get('LearnerInfo')
  const id = info.get('Identification')
  const contact = id.get('ContactInfo')
  const address = contact.get('Address', 'Contact')
  const wl = info.get('WorkExperienceList').all('WorkExperience')
  const el2 = info.get('EducationList').all('Education')
  const ling = info.get('Skills', 'Linguistic')
  return normalizeStructured({
    basics: {
      name: [id.get('PersonName', 'FirstName').text(), id.get('PersonName', 'Surname').text()].filter(Boolean).join(' '),
      headline: info.get('Headline', 'Description', 'Label').text(),
      email: contact.get('Email', 'Contact').text(),
      phone: contact.get('TelephoneList').all('Telephone')[0]?.get('Contact').text() ?? '',
      location: [address.get('Municipality').text(), address.get('Country', 'Label').text()].filter(Boolean).join(', '),
      linkedin: '',
      website: contact.get('WebsiteList').all('Website')[0]?.get('Contact').text() ?? '',
      summary: '',
    },
    experience: wl.map((w) => ({
      id: '',
      company: w.get('Employer', 'Name').text(),
      title: w.get('Position', 'Label').text(),
      location: w.get('Employer', 'ContactInfo', 'Address', 'Contact', 'Municipality').text(),
      start: legacyDate(w.get('Period', 'From')),
      end: legacyDate(w.get('Period', 'To')),
      current: w.get('Period', 'Current').text() === 'true',
      bullets: htmlToLines(w.get('Activities').text()),
    })),
    education: el2.map((e) => ({
      id: '',
      institution: e.get('Organisation', 'Name').text(),
      degree: e.get('Title').text(),
      field: '',
      start: legacyDate(e.get('Period', 'From')),
      end: legacyDate(e.get('Period', 'To')),
      grade: '',
    })),
    skills: htmlToLines(info.get('Skills', 'Computer', 'Description').text()).length
      ? [{ group: 'Digital skills', items: htmlToLines(info.get('Skills', 'Computer', 'Description').text()) }]
      : [],
    languages: [
      ...ling.all('MotherTongue').map((m) => ({ name: m.get('Description', 'Label').text(), level: 'Native' })),
      ...ling.all('ForeignLanguage').map((f) => ({ name: f.get('Description', 'Label').text(), level: f.get('ProficiencyLevel', 'Speaking').text() })),
    ],
    projects: [],
    certifications: [],
    publications: [],
    references: [],
  })
}

function fromLegacyXml(root: Element): StructuredProfile {
  return fromLegacy(xmlLegacy(root))
}

/** Legacy Europass JSON: {"SkillsPassport": {"LearnerInfo": ...}}. */
export function isLegacyEuropassJson(v: unknown) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'SkillsPassport' in (v as object)
}
export const fromLegacyEuropassJson = (v: unknown) => fromLegacy(jsonLegacy((v as { SkillsPassport: unknown }).SkillsPassport))
