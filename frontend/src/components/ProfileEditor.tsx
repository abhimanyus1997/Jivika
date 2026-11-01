import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { StructuredProfile } from '../lib/api'
import { moveItem, newId, SECTION_KEYS, type SectionKey } from '../lib/store'
import { SECTION_TITLES, shownOnResume, type Basics, type ContactKey } from './ResumeDoc'
import { Button, Card, Field, IconButton, inputCls, ProgressBar, textareaCls } from './ui'

/* ---------- Reorderable list: drag handle plus move buttons for keyboard and screen reader users ---------- */

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onMove,
  render,
  label,
}: {
  items: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  onMove: (from: number, to: number) => void
  /** Row content; the handle and move buttons are drawn around it. */
  render: (item: T, index: number) => ReactNode
  label: string
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return
    onMove(from, to)
    setAnnounce(`${getLabel(items[from])} moved to position ${to + 1} of ${items.length}.`)
  }

  return (
    <>
      <ul aria-label={label} className="space-y-2">
        {items.map((item, i) => (
          <li
            key={getKey(item)}
            // Only the handle starts a drag, so text in the row's inputs stays selectable.
            draggable={armed === i}
            onDragStart={(e) => {
              setDrag(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(i))
            }}
            onDragOver={(e) => {
              if (drag === null) return
              e.preventDefault()
              setOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag !== null) move(drag, i)
              setDrag(null)
              setOver(null)
            }}
            onDragEnd={() => {
              setDrag(null)
              setOver(null)
              setArmed(null)
            }}
            className={`flex items-start gap-1 rounded-lg border bg-surface p-2 transition-colors duration-150 ${
              over === i && drag !== null && drag !== i ? 'border-brand-500' : 'border-line'
            } ${drag === i ? 'opacity-50' : ''}`}
          >
            <span
              className="mt-0.5 flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-faint hover:bg-subtle hover:text-muted active:cursor-grabbing"
              onPointerDown={() => setArmed(i)}
              onPointerUp={() => setArmed(null)}
              title="Drag to reorder"
              aria-hidden="true"
            >
              <GripVertical className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">{render(item, i)}</div>
            <div className="flex shrink-0">
              <IconButton icon={ChevronUp} size="sm" label={`Move ${getLabel(item)} up`} disabled={i === 0} onClick={() => move(i, i - 1)} />
              <IconButton icon={ChevronDown} size="sm" label={`Move ${getLabel(item)} down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)} />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </>
  )
}

/* ---------- Section schemas ---------- */

type FieldType = 'text' | 'textarea' | 'lines' | 'list' | 'check'
interface FieldDef {
  key: string
  label: string
  type?: FieldType
  wide?: boolean
  placeholder?: string
}
type Item = Record<string, unknown> & { id?: string }

const DATE_HINT = 'e.g. Mar 2022'
const SCHEMA: Record<SectionKey, { singular: string; fields: FieldDef[]; title: (i: Item) => string }> = {
  experience: {
    singular: 'position',
    title: (i) => [i.title, i.company].filter(Boolean).join(' at ') || 'New position',
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'company', label: 'Company' },
      { key: 'location', label: 'Location' },
      { key: 'current', label: 'I currently work here', type: 'check' },
      { key: 'start', label: 'Start', placeholder: DATE_HINT },
      { key: 'end', label: 'End', placeholder: DATE_HINT },
      { key: 'bullets', label: 'Achievements, one per line', type: 'lines', wide: true, placeholder: 'Cut page load time by 40% by ...' },
    ],
  },
  projects: {
    singular: 'project',
    title: (i) => String(i.name || 'New project'),
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Your role' },
      { key: 'link', label: 'Link', wide: true },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      { key: 'bullets', label: 'Highlights, one per line', type: 'lines', wide: true },
    ],
  },
  education: {
    singular: 'education',
    title: (i) => String(i.institution || i.degree || 'New education'),
    fields: [
      { key: 'institution', label: 'Institution', wide: true },
      { key: 'degree', label: 'Degree' },
      { key: 'field', label: 'Field of study' },
      { key: 'start', label: 'Start', placeholder: DATE_HINT },
      { key: 'end', label: 'End', placeholder: DATE_HINT },
      { key: 'grade', label: 'Grade or honours', wide: true },
    ],
  },
  skills: {
    singular: 'skill group',
    title: (i) => String(i.group || 'Skills'),
    fields: [
      { key: 'group', label: 'Group', placeholder: 'e.g. Languages, Tools' },
      { key: 'items', label: 'Skills, comma separated', type: 'list', wide: true },
    ],
  },
  languages: {
    singular: 'language',
    title: (i) => String(i.name || 'New language'),
    fields: [
      { key: 'name', label: 'Language' },
      { key: 'level', label: 'Level', placeholder: 'e.g. Native, Fluent' },
    ],
  },
  certifications: {
    singular: 'certification',
    title: (i) => String(i.name || 'New certification'),
    fields: [
      { key: 'name', label: 'Name', wide: true },
      { key: 'issuer', label: 'Issuer' },
      { key: 'year', label: 'Year' },
    ],
  },
  publications: {
    singular: 'publication',
    title: (i) => String(i.citation || 'New publication').slice(0, 80),
    fields: [{ key: 'citation', label: 'Citation', type: 'textarea', wide: true }],
  },
  references: {
    singular: 'reference',
    title: (i) => String(i.name || 'New reference'),
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'relation', label: 'Relationship' },
      { key: 'contact', label: 'Contact', wide: true },
    ],
  },
}

function blankItem(section: SectionKey): Item {
  const item: Item = { id: newId() }
  for (const f of SCHEMA[section].fields) item[f.key] = f.type === 'lines' || f.type === 'list' ? [] : f.type === 'check' ? false : ''
  return item
}

/** Field a term from '+ Add to profile' goes into, per section. */
/** Field that takes the term from '+ Add to profile'. Experience gets none: a bullet would read as a fact. */
const PREFILL: Record<SectionKey, string> = {
  experience: '',
  projects: 'name',
  education: 'degree',
  skills: 'items',
  languages: 'name',
  certifications: 'name',
  publications: 'citation',
  references: 'name',
}

/** A new item for the section with the term filled in, for deep links like #profile?section=skills&add=Docker. */
export function prefilledItem(section: SectionKey, term: string): Item & { id: string } {
  const item = blankItem(section) as Item & { id: string }
  const key = PREFILL[section]
  if (key) item[key] = Array.isArray(item[key]) ? [term] : term
  return item
}

/** Items in a section, for the section list (skills count each skill, not each group). */
export function sectionCount(p: StructuredProfile, k: SectionKey) {
  return k === 'skills' ? p.skills.reduce((n, g) => n + g.items.filter((x) => x.trim()).length, 0) : p[k].length
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const cls = field.wide ? 'sm:col-span-2' : ''
  if (field.type === 'check') {
    return (
      <label className={`flex items-center gap-2 self-end pb-1.5 text-[13px] text-ink ${cls}`}>
        <input type="checkbox" className="size-4 accent-brand-600" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    )
  }
  // Lists are split without trimming while typing, so the text round-trips exactly; the renderer trims.
  const text = field.type === 'lines' ? ((value as string[]) ?? []).join('\n') : field.type === 'list' ? ((value as string[]) ?? []).join(',') : String(value ?? '')
  const set = (t: string) => onChange(field.type === 'lines' ? t.split('\n') : field.type === 'list' ? t.split(',') : t)
  return (
    <div className={cls}>
      <Field label={field.label}>
        {field.type === 'textarea' || field.type === 'lines' ? (
          <textarea className={`${textareaCls} field-sizing-content min-h-20`} value={text} placeholder={field.placeholder} onChange={(e) => set(e.target.value)} />
        ) : (
          <input className={inputCls} value={text} placeholder={field.placeholder} onChange={(e) => set(e.target.value)} />
        )}
      </Field>
    </div>
  )
}

function SectionEditor({ section, items, onChange, openItem }: { section: SectionKey; items: Item[]; onChange: (items: Item[]) => void; openItem?: string }) {
  const schema = SCHEMA[section]
  const [open, setOpen] = useState<Set<string>>(() => new Set(openItem ? [openItem] : []))
  useEffect(() => {
    if (!openItem || !items.some((i) => i.id === openItem)) return
    setOpen((s) => new Set([...s, openItem]))
    // Wait for the item to expand, then bring it into view and focus its first field.
    requestAnimationFrame(() => {
      const el = document.getElementById(`profile-item-${openItem}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true })
    })
  }, [openItem])
  const toggle = (id: string) => setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]))
  const patch = (i: number, k: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)))

  return (
    <div id={`profile-section-${section}`} className="scroll-mt-20">
    <Card
      title={SECTION_TITLES[section]}
      action={
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          onClick={() => {
            const item = blankItem(section)
            onChange([...items, item])
            setOpen((s) => new Set([...s, item.id!]))
          }}
        >
          Add {schema.singular}
        </Button>
      }
    >
      {items.length ? (
        <SortableList
          label={SECTION_TITLES[section]}
          items={items}
          getKey={(i) => i.id!}
          getLabel={schema.title}
          onMove={(from, to) => onChange(moveItem(items, from, to))}
          render={(item, i) => {
            const expanded = open.has(item.id!)
            return (
              <div id={`profile-item-${item.id}`}>
                <div className="flex min-h-7 items-center gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink hover:text-brand-700"
                    aria-expanded={expanded}
                    onClick={() => toggle(item.id!)}
                  >
                    {schema.title(item)}
                  </button>
                  <IconButton icon={Pencil} size="sm" label={`${expanded ? 'Close' : 'Edit'} ${schema.title(item)}`} onClick={() => toggle(item.id!)} />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={`Delete ${schema.title(item)}`}
                    className="hover:bg-danger-bg hover:text-danger"
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                  />
                </div>
                {expanded && (
                  <div className="mt-2 grid gap-3 pb-1 sm:grid-cols-2">
                    {schema.fields.map((f) => (
                      <FieldInput key={f.key} field={f} value={item[f.key]} onChange={(v) => patch(i, f.key, v)} />
                    ))}
                  </div>
                )}
              </div>
            )
          }}
        />
      ) : (
        <p className="text-[13px] text-muted">No {SECTION_TITLES[section].toLowerCase()} added yet.</p>
      )}
    </Card>
    </div>
  )
}

type BasicKey = Exclude<keyof Basics, 'show' | 'summary'>
const BASICS: { key: BasicKey; label: string; type?: string; wide?: boolean; hint?: string; contact?: ContactKey }[] = [
  { key: 'name', label: 'Name' },
  { key: 'headline', label: 'Headline' },
  { key: 'email', label: 'Email', type: 'email', contact: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', contact: 'phone' },
  { key: 'linkedin', label: 'LinkedIn', contact: 'linkedin' },
  { key: 'website', label: 'Website', contact: 'website' },
  { key: 'location', label: 'Location on resume', hint: 'e.g. Pune, India. Left blank, city and country are used.', wide: true, contact: 'location' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
  { key: 'address', label: 'Street address', wide: true, contact: 'address', hint: 'Optional. Most resumes only need a city.' },
  { key: 'birth_date', label: 'Date of birth', type: 'date', contact: 'birth_date', hint: 'Optional. Many employers do not need it, and some regions advise leaving it out.' },
]

function BasicsCard({ value, onChange }: { value: StructuredProfile; onChange: (next: StructuredProfile) => void }) {
  const b = value.basics as Basics
  const setBasics = (next: Basics) => onChange({ ...value, basics: next })
  return (
    <div id="profile-section-basics" className="scroll-mt-20">
      <Card title="Basics" description="Personal details. Choose which ones appear on your resume.">
        <div className="grid gap-3 sm:grid-cols-2">
          {BASICS.map((f) => (
            <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
              <Field label={f.label} hint={f.hint}>
                <input type={f.type ?? 'text'} className={inputCls} value={b[f.key] ?? ''} onChange={(e) => setBasics({ ...b, [f.key]: e.target.value })} />
              </Field>
              {f.contact && (
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-brand-600"
                    checked={shownOnResume(b, f.contact)}
                    onChange={(e) => setBasics({ ...b, show: { ...b.show, [f.contact!]: e.target.checked } })}
                  />
                  Show on resume
                </label>
              )}
            </div>
          ))}
          <div className="sm:col-span-2">
            <Field label="A few lines about you" hint="Used as the summary at the top of your resume.">
              <textarea className={`${textareaCls} field-sizing-content min-h-24`} value={b.summary ?? ''} onChange={(e) => setBasics({ ...b, summary: e.target.value })} />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  )
}

/** Drag or arrow-key order of resume sections. */
export function SectionOrder({ order, onChange }: { order: SectionKey[]; onChange: (order: SectionKey[]) => void }) {
  return (
    <Card title="Section order" description="Drag or use the arrows. The resume follows this order.">
      <SortableList
        label="Section order"
        items={order}
        getKey={(k) => k}
        getLabel={(k) => SECTION_TITLES[k]}
        onMove={(from, to) => onChange(moveItem(order, from, to))}
        render={(k) => <span className="flex min-h-7 items-center text-[13px] text-ink">{SECTION_TITLES[k]}</span>}
      />
    </Card>
  )
}

/** Full editor for a structured profile. Sections follow `order`. */
export function ProfileEditor({
  value,
  onChange,
  order = [...SECTION_KEYS],
  openItem,
}: {
  value: StructuredProfile
  onChange: (next: StructuredProfile) => void
  order?: SectionKey[]
  /** Item to expand and scroll to (from a deep link). */
  openItem?: string
}) {
  return (
    <div className="space-y-4">
      <BasicsCard value={value} onChange={onChange} />
      {order.map((k) => (
        <SectionEditor
          key={k}
          section={k}
          openItem={openItem}
          items={value[k] as unknown as Item[]}
          onChange={(items) => onChange({ ...value, [k]: items } as StructuredProfile)}
        />
      ))}
    </div>
  )
}

/* ---------- Profile strength ---------- */

const QUANTIFIED = /\d|%|\$|₹|£|€/

export function profileStrength(p: StructuredProfile) {
  const b = p.basics
  const bullets = [...p.experience, ...p.projects].flatMap((i) => i.bullets.map((x) => x.trim()).filter(Boolean))
  const quantified = bullets.filter((x) => QUANTIFIED.test(x)).length
  const withBullets = p.experience.filter((e) => e.bullets.some((x) => x.trim())).length
  const skills = p.skills.flatMap((g) => g.items.map((s) => s.trim()).filter(Boolean)).length
  const checks = [
    { label: 'Contact details', weight: 15, ok: !!(b.name.trim() && b.email.trim() && (b.phone.trim() || b.linkedin.trim())), tip: 'Add your name, email and a phone number or LinkedIn URL.' },
    { label: 'Summary', weight: 15, ok: b.summary.trim().length >= 120, tip: 'Write a summary of two to four sentences (at least 120 characters).' },
    {
      label: 'Experience',
      weight: 25,
      ok: withBullets >= 2,
      partial: withBullets === 1,
      tip: 'List at least two positions, each with achievement bullets.',
    },
    { label: 'Quantified results', weight: 15, ok: bullets.length > 0 && quantified / bullets.length >= 0.3, tip: 'Add numbers to at least a third of your bullets: percentages, amounts, team sizes or time saved.' },
    { label: 'Skills', weight: 15, ok: skills >= 5, tip: 'Add at least five skills, grouped by type.' },
    { label: 'Education', weight: 15, ok: p.education.length > 0, tip: 'Add your highest qualification.' },
  ]
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : c.partial ? Math.round(c.weight / 2) : 0), 0)
  return { score, checks, quantified, bullets: bullets.length }
}

export function StrengthMeter({ profile, compact = false }: { profile: StructuredProfile; compact?: boolean }) {
  const s = profileStrength(profile)
  const todo = s.checks.filter((c) => !c.ok)
  return (
    <Card title="Profile strength" description={compact ? undefined : 'How complete your profile is for a strong resume.'}>
      <div className="space-y-4">
        <ProgressBar value={s.score} label="Strength" suffix="/100" />
        <ul className={`grid gap-1.5 text-[13px] ${compact ? '' : 'sm:grid-cols-2'}`}>
          {s.checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-full ${c.ok ? 'bg-brand-500' : 'bg-line-strong'}`} aria-hidden="true" />
              <span className={c.ok ? 'text-ink' : 'text-muted'}>{c.label}</span>
              <span className="sr-only">{c.ok ? 'complete' : 'to do'}</span>
              {c.label === 'Quantified results' && s.bullets > 0 && (
                <span className="t-num text-xs text-faint">
                  {s.quantified}/{s.bullets}
                </span>
              )}
            </li>
          ))}
        </ul>
        {todo.length > 0 && (
          <div>
            <h3 className="t-overline mb-1.5">{compact ? 'Next step' : 'Tips'}</h3>
            <ul className="space-y-1 text-[13px] leading-5 text-muted">
              {todo.slice(0, compact ? 1 : undefined).map((c) => (
                <li key={c.label}>{c.tip}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
