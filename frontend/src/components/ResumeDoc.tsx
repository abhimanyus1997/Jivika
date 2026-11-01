import '@fontsource/lora/400.css'
import '@fontsource/lora/400-italic.css'
import '@fontsource/lora/600.css'
import '@fontsource-variable/josefin-sans'
import './resume-doc.css'
import { CalendarDays, Globe, House, Link2, Mail, MapPin, Phone, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ProfileBasics, StructuredProfile } from '../lib/api'
import { BUILT_IN, FONTS, resolveTheme, type DesignSettings, type ResumeDesign } from '../lib/resume-themes'
import type { ResumeTheme, SectionKey } from '../lib/store'

/** Built-in themes as picker options. The full definitions live in lib/resume-themes. */
export const THEMES: { value: ResumeTheme; label: string; hint: string }[] = BUILT_IN.map((t) => ({ value: t.id as ResumeTheme, label: t.name, hint: t.hint }))

/** Optional personal fields, kept in basics. Older profiles and the server schema do not have them. */
export interface PersonalFields {
  city?: string
  country?: string
  address?: string
  /** yyyy-mm-dd */
  birth_date?: string
  /** Per-field 'Show on resume' choice; missing means the default below. */
  show?: Partial<Record<ContactKey, boolean>>
}
export type Basics = ProfileBasics & PersonalFields

export const CONTACT_FIELDS = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'phone', label: 'Phone', icon: Phone },
  { key: 'location', label: 'Location', icon: MapPin },
  { key: 'linkedin', label: 'LinkedIn', icon: Link2 },
  { key: 'website', label: 'Website', icon: Globe },
  { key: 'address', label: 'Street address', icon: House },
  { key: 'birth_date', label: 'Date of birth', icon: CalendarDays },
] as const satisfies readonly { key: string; label: string; icon: LucideIcon }[]
export type ContactKey = (typeof CONTACT_FIELDS)[number]['key']

/** Street address and date of birth stay off the resume unless switched on. */
export const shownOnResume = (b: Basics, key: ContactKey) => b.show?.[key] ?? !(key === 'address' || key === 'birth_date')

const birthDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function contactValue(b: Basics, key: ContactKey): string {
  if (key === 'location') return b.location?.trim() || [b.city, b.country].map((x) => x?.trim()).filter(Boolean).join(', ')
  if (key === 'birth_date') return b.birth_date?.trim() ? birthDate(b.birth_date.trim()) : ''
  return (b[key] ?? '').trim()
}

export const SECTION_TITLES: Record<SectionKey | 'summary', string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Certifications',
  publications: 'Publications',
  references: 'References',
}

const SIDE: SectionKey[] = ['skills', 'languages', 'certifications']
/** The narrow right-hand column of the 'columns' layout. */
const RIGHT: SectionKey[] = ['skills', 'education', 'languages', 'certifications']
const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean)
const range = (start: string, end: string, current?: boolean) => [start, current ? 'Present' : end].map((s) => s?.trim()).filter(Boolean).join(' – ')

function Section({ id, children }: { id: SectionKey | 'summary'; children: ReactNode }) {
  return (
    <section className="rs-section" data-section={id}>
      <h3 className="rs-h">{SECTION_TITLES[id]}</h3>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  const list = clean(items)
  return list.length ? (
    <ul className="rs-bullets">
      {list.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  ) : null
}

function Entry({ title, sub, meta, children }: { title: string; sub?: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="rs-entry">
      <div className="rs-entry-head">
        <div className="min-w-0">
          <span className="rs-entry-title">{title}</span>
          {sub && <span className="rs-entry-sub">{sub}</span>}
        </div>
        {meta && <span className="rs-meta">{meta}</span>}
      </div>
      {children}
    </div>
  )
}

function renderSection(key: SectionKey, p: StructuredProfile): ReactNode {
  switch (key) {
    case 'experience':
      return p.experience.length > 0 && (
        <Section id={key}>
          {p.experience.map((e) => (
            <Entry key={e.id} title={e.title || 'Role'} sub={[e.company, e.location].filter((x) => x?.trim()).join(', ')} meta={range(e.start, e.end, e.current)}>
              <Bullets items={e.bullets} />
            </Entry>
          ))}
        </Section>
      )
    case 'projects':
      return p.projects.length > 0 && (
        <Section id={key}>
          {p.projects.map((x) => (
            <Entry key={x.id} title={x.name || 'Project'} sub={x.role} meta={x.link}>
              {x.description?.trim() && <p className="rs-p">{x.description}</p>}
              <Bullets items={x.bullets} />
            </Entry>
          ))}
        </Section>
      )
    case 'education':
      return p.education.length > 0 && (
        <Section id={key}>
          {p.education.map((e) => (
            <Entry
              key={e.id}
              title={[e.degree, e.field].filter((x) => x?.trim()).join(', ') || e.institution}
              sub={e.degree || e.field ? e.institution : undefined}
              meta={range(e.start, e.end)}
            >
              {e.grade?.trim() && <p className="rs-p">{e.grade}</p>}
            </Entry>
          ))}
        </Section>
      )
    case 'skills':
      return p.skills.some((g) => clean(g.items).length) && (
        <Section id={key}>
          <dl className="rs-skills">
            {p.skills
              .filter((g) => clean(g.items).length)
              .map((g) => (
                <div key={g.id ?? g.group}>
                  {g.group?.trim() && <dt>{g.group}</dt>}
                  <dd>{clean(g.items).join(', ')}</dd>
                </div>
              ))}
          </dl>
        </Section>
      )
    case 'languages':
      return p.languages.length > 0 && (
        <Section id={key}>
          <p className="rs-p">{p.languages.map((l) => [l.name, l.level && `(${l.level})`].filter(Boolean).join(' ')).join(', ')}</p>
        </Section>
      )
    case 'certifications':
      return p.certifications.length > 0 && (
        <Section id={key}>
          <ul className="rs-plain">
            {p.certifications.map((c) => (
              <li key={c.id}>
                <span className="rs-strong">{c.name}</span>
                {[c.issuer, c.year].filter((x) => x?.trim()).length > 0 && <span className="rs-muted">, {[c.issuer, c.year].filter((x) => x?.trim()).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )
    case 'publications':
      return p.publications.length > 0 && (
        <Section id={key}>
          <ul className="rs-plain">
            {p.publications.map((x) => (
              <li key={x.id}>{x.citation}</li>
            ))}
          </ul>
        </Section>
      )
    case 'references':
      return p.references.length > 0 && (
        <Section id={key}>
          <ul className="rs-plain rs-refs">
            {p.references.map((r) => (
              <li key={r.id}>
                <span className="rs-strong">{r.name}</span>
                {r.relation && <span className="rs-muted">, {r.relation}</span>}
                {r.contact && <span className="block rs-muted">{r.contact}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )
  }
}

export interface ResumeDocProps {
  profile: StructuredProfile
  settings: DesignSettings
  /** Renders this design instead of the one in settings (theme thumbnails). */
  design?: ResumeDesign
}

const MM = 96 / 25.4
/** Top and bottom margins are a little tighter than the sides. */
const marginsMm = (d: ResumeDesign) => ({ y: Math.round(d.margin * 0.9 * 10) / 10, x: d.margin })

function docStyle(d: ResumeDesign, accent: string) {
  const m = marginsMm(d)
  return {
    '--rs-accent': accent,
    '--rs-head-font': FONTS[d.font].head,
    '--rs-body-font': FONTS[d.font].body,
    '--rs-body': `${d.size}pt`,
    '--rs-leading': d.leading,
    '--rs-pad-y': `${m.y}mm`,
    '--rs-pad-x': `${m.x}mm`,
    '--rs-gap': `${d.gap}mm`,
  } as CSSProperties
}

/** The resume itself, the same on screen and in print. Paper is white with dark ink in both app themes. */
export function ResumeDoc({ profile: p, settings, design }: ResumeDocProps) {
  const resolved = resolveTheme(settings)
  const d = design ?? resolved.design
  const b = p.basics as Basics
  const contact = CONTACT_FIELDS.filter((f) => shownOnResume(b, f.key))
    .map((f) => ({ ...f, value: contactValue(b, f.key) }))
    .filter((f) => f.value)
  const visible = settings.order.filter((k) => !settings.hidden.includes(k))
  const side = d.layout === 'sidebar' ? SIDE : d.layout === 'columns' ? RIGHT : []
  const summary = !settings.hidden.includes('summary') && b.summary?.trim() && (
    <Section id="summary">
      <p className="rs-p">{b.summary}</p>
    </Section>
  )
  const contactBlock = contact.length > 0 && (
    <address className="rs-contact">
      {contact.map(({ key, label, value, icon: Icon }) => (
        <span key={key}>
          {d.icons && <Icon className="rs-icon" strokeWidth={2} aria-hidden="true" />}
          {d.icons && <span className="sr-only">{label}: </span>}
          {value}
        </span>
      ))}
    </address>
  )
  const sections = (keys: SectionKey[]) => keys.map((k) => <Fragment key={k}>{renderSection(k, p)}</Fragment>)
  return (
    <article
      className="rs"
      data-rtheme={resolved.theme.id}
      data-layout={d.layout}
      data-header={d.header}
      data-heading={d.heading}
      data-name={d.name}
      data-dates={d.dates}
      style={docStyle(d, settings.accent)}
    >
      <header className="rs-head">
        <div className="rs-title">
          <h2 className="rs-name">{b.name || 'Your name'}</h2>
          {b.headline && <p className="rs-headline">{b.headline}</p>}
        </div>
        {d.layout !== 'sidebar' && contactBlock}
      </header>
      {side.length ? (
        <div className="rs-cols">
          <aside className="rs-side">
            {d.layout === 'sidebar' && contactBlock && (
              <section className="rs-section">
                <h3 className="rs-h">Contact</h3>
                {contactBlock}
              </section>
            )}
            {sections(visible.filter((k) => side.includes(k)))}
          </aside>
          <div className="rs-main">
            {summary}
            {sections(visible.filter((k) => !side.includes(k)))}
          </div>
        </div>
      ) : (
        <>
          {summary}
          {sections(visible)}
        </>
      )}
    </article>
  )
}

/** Pages the resume fills on A4, from its rendered height. */
export function pageCount(el: HTMLElement) {
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
  const page = 297 * MM - 2 * pad
  const content = el.scrollHeight - 2 * pad
  return Math.max(1, Math.ceil((content - 1) / page))
}

/** A4 preview, scaled down to fit narrow columns (print is unaffected). */
export function ResumePaper({ onPages, ...props }: ResumeDocProps & { onPages?: (pages: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / 794)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const doc = wrap.current?.querySelector<HTMLElement>('.rs')
    if (!doc || !onPages) return
    const ro = new ResizeObserver(() => onPages(pageCount(doc)))
    ro.observe(doc)
    return () => ro.disconnect()
  }, [onPages])
  return (
    <div ref={wrap} className="w-full">
      <div className="mx-auto w-fit rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_-6px_rgba(0,0,0,0.18)]" style={{ zoom }}>
        <ResumeDoc {...props} />
      </div>
    </div>
  )
}

/** First page of the resume at thumbnail size, for the theme gallery. Not interactive and hidden from assistive tech. */
export function ResumeThumb({ width = 150, ...props }: ResumeDocProps & { width?: number }) {
  const zoom = width / 794
  return (
    <div aria-hidden="true" inert className="overflow-hidden rounded-sm bg-white ring-1 ring-line" style={{ width, height: Math.round(width * 1.414) }}>
      <div style={{ zoom }}>
        <ResumeDoc {...props} />
      </div>
    </div>
  )
}

/** Print-only copy, portalled to body so only the resume prints. Mount it whenever Download PDF is available. */
export function ResumePrint(props: ResumeDocProps) {
  const m = marginsMm(props.design ?? resolveTheme(props.settings).design)
  return createPortal(
    <div className="resume-print" aria-hidden="true">
      <style>{`@page resume { size: A4; margin: ${m.y}mm ${m.x}mm; }`}</style>
      <ResumeDoc {...props} />
    </div>,
    document.body,
  )
}

/** Opens the print dialog with a PDF-friendly document title. */
export function printResume(name: string, company?: string) {
  const title = document.title
  document.title = ['Resume', name, company].filter(Boolean).join(' - ')
  window.addEventListener('afterprint', () => (document.title = title), { once: true })
  window.print()
}
