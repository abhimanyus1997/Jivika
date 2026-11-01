import '@fontsource/lora/400.css'
import '@fontsource/lora/400-italic.css'
import '@fontsource/lora/600.css'
import '@fontsource-variable/josefin-sans'
import './resume-doc.css'
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { StructuredProfile } from '../lib/api'
import type { ResumeSettings, ResumeTheme, SectionKey } from '../lib/store'

export const THEMES: { value: ResumeTheme; label: string; hint: string }[] = [
  { value: 'classic', label: 'Classic', hint: 'Serif, centred header' },
  { value: 'modern', label: 'Modern', hint: 'Sans with accent headings' },
  { value: 'compact', label: 'Compact', hint: 'Dense, fits more on a page' },
  { value: 'sidebar', label: 'Two-column', hint: 'Sidebar for skills and contact' },
  { value: 'minimal', label: 'Minimal', hint: 'Quiet, generous spacing' },
  { value: 'executive', label: 'Executive', hint: 'Spaced capitals, serif body' },
]

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
  settings: ResumeSettings
}

/** The resume itself, the same on screen and in print. Paper is white with dark ink in both app themes. */
export function ResumeDoc({ profile: p, settings }: ResumeDocProps) {
  const b = p.basics
  const contact = [b.email, b.phone, b.location, b.linkedin, b.website].filter((x) => x?.trim())
  const visible = settings.order.filter((k) => !settings.hidden.includes(k))
  const sidebar = settings.theme === 'sidebar'
  const summary = !settings.hidden.includes('summary') && b.summary?.trim() && (
    <Section id="summary">
      <p className="rs-p">{b.summary}</p>
    </Section>
  )
  const contactBlock = contact.length > 0 && (
    <address className="rs-contact">
      {contact.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </address>
  )
  return (
    <article className="rs" data-rtheme={settings.theme} style={{ '--rs-accent': settings.accent } as CSSProperties}>
      <header className="rs-head">
        <h2 className="rs-name">{b.name || 'Your name'}</h2>
        {b.headline && <p className="rs-headline">{b.headline}</p>}
        {!sidebar && contactBlock}
      </header>
      {sidebar ? (
        <div className="rs-cols">
          <aside className="rs-side">
            {contactBlock && (
              <section className="rs-section">
                <h3 className="rs-h">Contact</h3>
                {contactBlock}
              </section>
            )}
            {visible.filter((k) => SIDE.includes(k)).map((k) => (
              <Fragment key={k}>{renderSection(k, p)}</Fragment>
            ))}
          </aside>
          <div className="rs-main">
            {summary}
            {visible.filter((k) => !SIDE.includes(k)).map((k) => (
              <Fragment key={k}>{renderSection(k, p)}</Fragment>
            ))}
          </div>
        </div>
      ) : (
        <>
          {summary}
          {visible.map((k) => (
            <Fragment key={k}>{renderSection(k, p)}</Fragment>
          ))}
        </>
      )}
    </article>
  )
}

/** A4 preview, scaled down to fit narrow columns (print is unaffected). */
export function ResumePaper(props: ResumeDocProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / 794)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrap} className="w-full">
      <div className="mx-auto w-fit rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_-6px_rgba(0,0,0,0.18)]" style={{ zoom }}>
        <ResumeDoc {...props} />
      </div>
    </div>
  )
}

/** Print-only copy, portalled to body so only the resume prints. Mount it whenever Download PDF is available. */
export function ResumePrint(props: ResumeDocProps) {
  return createPortal(
    <div className="resume-print" aria-hidden="true">
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
