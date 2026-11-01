import { DEFAULT_RESUME_SETTINGS, newId, useResumeSettings, type ResumeSettings } from './store'

/* Resume themes as data. ResumeDoc turns a design into CSS variables and data attributes; resume-doc.css styles them. */

export const FONTS = {
  sans: { label: 'Geist', head: "'Geist Variable', ui-sans-serif, system-ui, sans-serif", body: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  serif: { label: 'Lora', head: "'Lora', Georgia, serif", body: "'Lora', Georgia, serif" },
  'serif-sans': { label: 'Lora and Geist', head: "'Lora', Georgia, serif", body: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  'caps-serif': { label: 'Josefin Sans and Lora', head: "'Josefin Sans Variable', 'Century Gothic', sans-serif", body: "'Lora', Georgia, serif" },
  'caps-sans': { label: 'Josefin Sans and Geist', head: "'Josefin Sans Variable', 'Century Gothic', sans-serif", body: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  'mono-sans': { label: 'Geist Mono and Geist', head: "'Geist Mono Variable', ui-monospace, monospace", body: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
} as const
export type FontPair = keyof typeof FONTS

export const HEADINGS = {
  rule: 'Capitals, light rule',
  underline: 'Capitals, dark rule',
  accent: 'Accent colour',
  quiet: 'Quiet, no rule',
  bar: 'Accent bar',
  lines: 'Rules above and below',
  band: 'Tinted band',
  centered: 'Centred',
} as const
export type HeadingStyle = keyof typeof HEADINGS

export const HEADERS = {
  left: 'Left aligned',
  rule: 'Left, accent rule',
  center: 'Centred',
  double: 'Double rule',
  inline: 'Name and headline on one line',
  banner: 'Dark band',
} as const
export type HeaderStyle = keyof typeof HEADERS

export const NAMES = { bold: 'Bold', light: 'Light', caps: 'Spaced capitals', accent: 'Accent colour' } as const
export type NameStyle = keyof typeof NAMES

export type Layout = 'single' | 'sidebar' | 'columns'

export interface ResumeDesign {
  font: FontPair
  /** Body size in pt. */
  size: number
  leading: number
  /** Page margin in mm (sides; top and bottom are a little less). */
  margin: number
  /** Space between sections in mm. */
  gap: number
  heading: HeadingStyle
  header: HeaderStyle
  name: NameStyle
  layout: Layout
  dates: 'right' | 'below'
  icons: boolean
}

export interface ThemeDef {
  id: string
  name: string
  hint: string
  design: ResumeDesign
  /** Custom themes only. */
  accent?: string
  custom?: boolean
}

const base: ResumeDesign = {
  font: 'sans',
  size: 10,
  leading: 1.45,
  margin: 17,
  gap: 5,
  heading: 'rule',
  header: 'left',
  name: 'bold',
  layout: 'single',
  dates: 'right',
  icons: false,
}
const theme = (id: string, name: string, hint: string, d: Partial<ResumeDesign>): ThemeDef => ({ id, name, hint, design: { ...base, ...d } })

export const BUILT_IN: ThemeDef[] = [
  theme('classic', 'Classic', 'Serif, centred header', { font: 'serif', header: 'center', heading: 'underline' }),
  theme('modern', 'Modern', 'Sans with accent headings', { header: 'rule', heading: 'accent' }),
  theme('compact', 'Compact', 'Dense, fits more on a page', { size: 9, leading: 1.35, margin: 13, gap: 3, header: 'inline' }),
  theme('sidebar', 'Two-column', 'Sidebar for skills and contact', { layout: 'sidebar', name: 'accent' }),
  theme('minimal', 'Minimal', 'Quiet, generous spacing', { margin: 22, gap: 7, name: 'light', heading: 'quiet' }),
  theme('executive', 'Executive', 'Spaced capitals, serif body', { font: 'caps-serif', header: 'double', name: 'caps', heading: 'accent' }),
  theme('broadsheet', 'Broadsheet', 'Serif name, ruled headings', { font: 'serif-sans', header: 'center', heading: 'lines', size: 9.5, gap: 4.5 }),
  theme('workbench', 'Workbench', 'Mono headings with accent bars', { font: 'mono-sans', heading: 'bar', dates: 'below', size: 9.5, icons: true }),
  theme('ledger', 'Ledger', 'Strong rules, tidy columns', { heading: 'underline', header: 'double', size: 9.5, leading: 1.4, margin: 15 }),
  theme('banner', 'Banner', 'Dark header band', { header: 'banner', heading: 'accent', icons: true }),
  theme('twin', 'Twin column', 'Compact, details on the right', { layout: 'columns', size: 9, leading: 1.35, margin: 13, gap: 3.5, heading: 'band' }),
  theme('grace', 'Grace', 'Centred, light and spacious', { font: 'caps-serif', header: 'center', name: 'light', heading: 'centered', margin: 20, gap: 6, leading: 1.5 }),
]

export const DEFAULT_ACCENT = DEFAULT_RESUME_SETTINGS.accent

/** Resume settings plus the theme designer. Stored in 'resumeSettings', so older readers keep working. */
export interface DesignSettings extends Omit<ResumeSettings, 'theme'> {
  theme: string
  /** Changes made in Customize, on top of the theme. */
  design?: Partial<ResumeDesign>
  customThemes?: ThemeDef[]
}

type Setter<T> = (next: T | ((prev: T) => T)) => void
export const useDesignSettings = () => useResumeSettings() as unknown as [DesignSettings, Setter<DesignSettings>]

export const allThemes = (s: Pick<DesignSettings, 'customThemes'>) => [...BUILT_IN, ...(s.customThemes ?? [])]

export function resolveTheme(s: Pick<DesignSettings, 'theme' | 'design' | 'customThemes'>): { theme: ThemeDef; design: ResumeDesign } {
  const t = allThemes(s).find((x) => x.id === s.theme) ?? BUILT_IN[1]
  return { theme: t, design: { ...t.design, ...s.design } }
}

export const isCustomized = (s: DesignSettings) => !!s.design && Object.keys(s.design).length > 0

/* ---------- Theme files ---------- */

const pick = <T extends string>(v: unknown, options: Record<T, unknown> | readonly T[], fallback: T): T =>
  typeof v === 'string' && (Array.isArray(options) ? options.includes(v as T) : Object.hasOwn(options, v)) ? (v as T) : fallback
const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && v >= min && v <= max ? v : fallback)

/** Accepts only known values, so a hand-edited or foreign file cannot inject styles. */
export function sanitizeDesign(raw: unknown): ResumeDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    font: pick(d.font, FONTS, base.font),
    size: num(d.size, 8, 12, base.size),
    leading: num(d.leading, 1.1, 1.8, base.leading),
    margin: num(d.margin, 8, 28, base.margin),
    gap: num(d.gap, 2, 10, base.gap),
    heading: pick(d.heading, HEADINGS, base.heading),
    header: pick(d.header, HEADERS, base.header),
    name: pick(d.name, NAMES, base.name),
    layout: pick(d.layout, ['single', 'sidebar', 'columns'] as const, base.layout),
    dates: pick(d.dates, ['right', 'below'] as const, base.dates),
    icons: d.icons === true,
  }
}

export const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function themeFile(t: ThemeDef) {
  return { app: 'jivika', kind: 'resume-theme', version: 1, name: t.name, hint: t.hint, accent: t.accent, design: t.design }
}

/** Reads a theme file. Returns a new custom theme, or an error message. */
export function parseThemeFile(raw: unknown): ThemeDef | string {
  const f = raw as Record<string, unknown> | null
  if (!f || typeof f !== 'object' || f.kind !== 'resume-theme') return 'This file is not a Jivika resume theme.'
  const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 40) : 'Imported theme'
  return {
    id: `custom-${newId()}`,
    name,
    hint: typeof f.hint === 'string' ? f.hint.slice(0, 60) : 'Imported',
    accent: isColor(f.accent) ? f.accent : undefined,
    design: sanitizeDesign(f.design),
    custom: true,
  }
}
