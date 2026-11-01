import { ChevronDown, ChevronUp, CircleAlert, Check, Copy, KeyRound, LoaderCircle, Sparkles, UserRound, X, type LucideIcon } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { isDemoLimit, isModelUnavailable, useDemoActive, useLocalProvider, type CareerPath } from '../lib/api'
import { statusTone, useApiKey, type Status } from '../lib/store'

/* ---------- Provider marks ---------- */

// ponytail: glob picks up any new <id>.svg; small files are inlined as data URIs by Vite.
const PROVIDER_ICONS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/providers/*.svg', { eager: true, query: '?url', import: 'default' })).map(
    ([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url],
  ),
)

// Black marks (OpenAI, Anthropic, xAI) use the ink token so they stay visible on dark surfaces.
export const PROVIDER_COLORS: Record<string, string> = {
  gemini: '#8E75B2',
  openai: 'var(--color-ink)',
  anthropic: 'var(--color-ink)',
  groq: '#F55036',
  mistral: '#FA520F',
  deepseek: '#4D6BFE',
  xai: 'var(--color-ink)',
  openrouter: '#6467F2',
  qwen: '#6950EF',
}

/**
 * Provider brand mark, monochrome in currentColor by default (`brand` uses the brand color).
 * Rendered as a CSS mask so the SVG file stays a plain asset. Unknown ids fall back to a monogram tile.
 */
export function ProviderIcon({ id, brand = false, className = 'size-4', label }: { id: string; brand?: boolean; className?: string; label?: string }) {
  const url = PROVIDER_ICONS[id]
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  if (!url) {
    return (
      <span {...a11y} className={`inline-flex shrink-0 items-center justify-center rounded-[5px] bg-current ${className}`}>
        <span className="text-[0.6em] leading-none font-bold text-surface uppercase">{id.slice(0, 1)}</span>
      </span>
    )
  }
  const mask = `url("${url}") center / contain no-repeat`
  return (
    <span
      {...a11y}
      className={`inline-block shrink-0 ${className}`}
      style={{ mask, WebkitMask: mask, backgroundColor: brand ? (PROVIDER_COLORS[id] ?? 'currentColor') : 'currentColor' }}
    />
  )
}

/* ---------- Form controls ---------- */

const control =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 ease-out hover:border-line-strong focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/15'

/** Text input / select class. 32px tall. */
export const inputCls = `${control} h-8 py-1 leading-5`
/** Textarea class (use with rows or a min-h override). */
export const textareaCls = `${control} min-h-24 py-2 leading-6`

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="t-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-4 text-faint">{hint}</span>}
    </label>
  )
}

/* ---------- Brand ---------- */

const LOGO_TILE = 'M168 0H476Q512 0 512 36V344Q512 512 344 512H36Q0 512 0 476V168Q0 0 168 0Z'
const LOGO_JI =
  'M325 -85Q274 -85 230.5 -110.5Q187 -136 150.0 -179.5Q113 -223 81.5 -278.0Q50 -333 22 -393L63 -411Q115 -302 173.0 -234.0Q231 -166 298 -166Q339 -166 362.0 -189.5Q385 -213 385 -246Q385 -278 360.5 -308.5Q336 -339 287 -361L260 -419V-430H561L562 -545H6L-28 -610V-620H729L763 -555V-545H646L648 10H638L558 -42L560 -355H383Q423 -314 443.5 -280.0Q464 -246 464 -208Q464 -169 444.5 -141.5Q425 -114 393.5 -99.5Q362 -85 325 -85ZM915 15H905L825 -37L829 -545H741L707 -610V-620H836Q829 -687 806.0 -727.0Q783 -767 750.5 -785.0Q718 -803 683 -803Q637 -803 612.0 -778.5Q587 -754 587 -716Q587 -690 601 -659L571 -642Q546 -668 533.5 -697.5Q521 -727 521 -756Q521 -806 556.0 -843.0Q591 -880 656 -880Q713 -880 762.5 -848.5Q812 -817 848.5 -758.5Q885 -700 902 -620H996L1030 -555V-545H913Z'
const LOGO_GLYPH = 'translate(37.58 441.65) scale(0.42)'

/** The जी monogram mark (docs/brand/jivika-mark.svg). Ids come from useId so several logos can share a page. */
export function Logo({ className = 'size-7' }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <clipPath id={`${id}t`}>
          <path d={LOGO_TILE} />
        </clipPath>
        <mask id={`${id}m`}>
          <rect width="512" height="512" fill="#fff" />
          <circle cx="271.1" cy="140.9" r="37" />
          <path transform={LOGO_GLYPH} d="M480 -600L560 -700L640 -720L600 -560Z" />
        </mask>
      </defs>
      <path d={LOGO_TILE} fill="#1F7A4D" />
      <rect x="0" y="178.7" width="512" height="36.5" fill="#fff" clipPath={`url(#${id}t)`} />
      <g mask={`url(#${id}m)`}>
        <path transform={LOGO_GLYPH} d={LOGO_JI} fill="#fff" stroke="#fff" strokeWidth="12" strokeLinejoin="round" />
      </g>
      <circle cx="271.1" cy="140.9" r="24.4" fill="#D98E04" />
    </svg>
  )
}

/* ---------- Layout ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="t-page-title">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Card({
  title,
  description,
  action,
  divider = false,
  padding = true,
  children,
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Draw a rule under the header row. */
  divider?: boolean
  /** Set false for edge-to-edge content (tables, lists). The header keeps its padding. */
  padding?: boolean
  children: ReactNode
  className?: string
}) {
  const header = title || action || description
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {header && (
        <div
          className={`flex items-start justify-between gap-3 px-5 ${divider ? 'border-b border-line py-4' : 'pt-5'} ${
            !divider && !padding ? 'pb-4' : ''
          }`}
        >
          <div className="min-w-0">
            {title && <h2 className="t-title">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={padding ? (header && !divider ? 'px-5 pt-4 pb-5' : 'p-5') : ''}>{children}</div>
    </section>
  )
}

/* ---------- Buttons ---------- */

const variants = {
  primary: 'bg-ink text-white hover:bg-black disabled:bg-ink/40',
  brand: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40',
  secondary: 'border border-line bg-surface text-ink hover:bg-subtle hover:border-line-strong disabled:text-faint',
  ghost: 'text-muted hover:bg-subtle hover:text-ink disabled:text-faint',
  danger: 'bg-danger text-white hover:bg-danger-hover disabled:bg-danger/40',
}
const sizes = { sm: 'h-7 gap-1.5 px-2.5 text-[13px]', md: 'h-8 gap-2 px-3 text-sm' }

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

const buttonCls = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  `inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]}`

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  loading?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonCls(variant, size)} ${className}`}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

/** An anchor styled as a button, for navigation actions. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className = '',
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon }) {
  return (
    <a className={`${buttonCls(variant, size)} ${className}`} {...rest}>
      {Icon && <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </a>
  )
}

/** Square icon-only button. `label` becomes aria-label and tooltip. */
export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: ButtonSize }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:text-faint ${
        size === 'sm' ? 'size-7' : 'size-8'
      } ${className}`}
      {...rest}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}

/* ---------- Badges ---------- */

const badgeTones = {
  neutral: 'bg-subtle text-muted ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  accent: 'bg-accent-50 text-accent-700 ring-accent-100',
  warning: 'bg-warning-bg text-warning ring-accent-100',
  danger: 'bg-danger-bg text-danger ring-danger-line',
  info: 'bg-info-bg text-info ring-info-line',
}
const outlineTones: Record<BadgeTone, string> = {
  neutral: 'text-muted ring-line-strong',
  brand: 'text-brand-700 ring-brand-200',
  accent: 'text-accent-700 ring-accent-200',
  warning: 'text-warning ring-accent-200',
  danger: 'text-danger ring-danger-line',
  info: 'text-info ring-info-line-strong',
}
const dotTones: Record<BadgeTone, string> = {
  neutral: 'bg-faint',
  brand: 'bg-brand-500',
  accent: 'bg-accent-500',
  warning: 'bg-accent-500',
  danger: 'bg-danger',
  info: 'bg-info',
}

export type BadgeTone = keyof typeof badgeTones

export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  mono = false,
  onRemove,
  removeLabel = 'Remove',
}: {
  children: ReactNode
  tone?: BadgeTone
  /** soft = tinted fill; outline = transparent with colored ring (e.g. missing skills). */
  variant?: 'soft' | 'outline'
  dot?: boolean
  mono?: boolean
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span
      className={`inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${
        variant === 'soft' ? badgeTones[tone] : `bg-surface ${outlineTones[tone]}`
      } ${mono ? 't-num' : ''}`}
    >
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${dotTones[tone]}`} aria-hidden="true" />}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel} ${typeof children === 'string' ? children : ''}`.trim()}
          className="-mr-1 rounded p-0.5 opacity-60 hover:bg-ink/5 hover:opacity-100"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={statusTone(status)} dot>
      {status}
    </Badge>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-subtle px-1 font-mono text-[11px] leading-none font-medium text-muted">
      {children}
    </kbd>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export function ShortcutHint() {
  return <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
}

/* ---------- Segmented control ---------- */

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  count?: number
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className = '',
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible group name. */
  label: string
  size?: ButtonSize
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-subtle p-0.5 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors duration-150 ${
              size === 'sm' ? 'h-6 text-xs' : 'h-7 text-[13px]'
            } ${active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`t-num text-[11px] ${active ? 'text-muted' : 'text-faint'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Scores ---------- */

/** Score band shared by rings and bars. The label always accompanies the color. */
export function scoreBand(score: number) {
  if (score >= 75) return { label: 'Strong', stroke: 'var(--color-brand-500)', bar: 'bg-brand-500', text: 'text-brand-700', tone: 'brand' as BadgeTone }
  if (score >= 50) return { label: 'Fair', stroke: 'var(--color-accent-500)', bar: 'bg-accent-500', text: 'text-accent-700', tone: 'warning' as BadgeTone }
  return { label: 'Needs work', stroke: 'var(--color-danger)', bar: 'bg-danger', text: 'text-danger', tone: 'danger' as BadgeTone }
}

/** Label row + thin bar. Use suffix="/100" for score rows. */
export function ProgressBar({ value, label, suffix = '%' }: { value: number; label: string; suffix?: string }) {
  const band = scoreBand(value)
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">{label}</span>
        <span className="t-num text-[13px] font-medium text-ink">
          {value}
          <span className="text-faint">{suffix}</span>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function ScoreRing({
  value,
  label,
  size = 128,
  showLabel = true,
}: {
  value: number
  label: string
  size?: number
  /** Show label and band text under the ring. */
  showLabel?: boolean
}) {
  const band = scoreBand(value)
  const r = 44
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={`${label}: ${value} out of 100, ${band.label}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-subtle)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={band.stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
        <text
          x="50"
          y="50"
          transform="rotate(90 50 50)"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ink font-mono text-[24px] font-semibold tracking-[-0.02em]"
        >
          {value}
        </text>
      </svg>
      {showLabel && (
        <div className="text-center">
          <div className="text-[13px] font-medium text-ink">{label}</div>
          <div className={`text-xs font-medium ${band.text}`}>{band.label}</div>
        </div>
      )}
    </div>
  )
}

/** KPI cell for a metric strip. Place several inside one Card with padding={false}. */
export function StatCell({
  label,
  value,
  suffix,
  delta,
  deltaSuffix = '',
  chart,
  href,
  linkLabel = 'Improve',
  empty,
  note,
}: {
  label: string
  /** null/undefined renders the empty text instead of a number. */
  value?: number | string | null
  suffix?: string
  /** Change since previous value. Positive = up (evergreen), negative = down (danger). */
  delta?: number | null
  deltaSuffix?: string
  /** e.g. <MiniBars /> from charts.tsx */
  chart?: ReactNode
  href?: string
  linkLabel?: string
  /** Shown when value is missing, e.g. "Run a CV review". */
  empty?: ReactNode
  /** Secondary line under the value, e.g. "Roadmap 40% complete". */
  note?: ReactNode
}) {
  const has = value !== null && value !== undefined && value !== ''
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="t-overline">{label}</span>
        {href && (
          <a href={href} className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline">
            {linkLabel}
          </a>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {has ? (
            <div className="flex items-baseline gap-2">
              <span className="t-metric">
                {value}
                {suffix && <span className="ml-0.5 text-sm font-medium text-faint">{suffix}</span>}
              </span>
              {delta !== undefined && delta !== null && delta !== 0 && (
                <Badge tone={delta > 0 ? 'brand' : 'danger'} mono>
                  {delta > 0 ? <ChevronUp className="-mx-0.5 inline size-3" aria-hidden="true" /> : <ChevronDown className="-mx-0.5 inline size-3" aria-hidden="true" />}
                  <span className="sr-only">{delta > 0 ? 'Up' : 'Down'}</span>
                  {Math.abs(delta)}
                  {deltaSuffix}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-[13px] text-muted">{empty ?? 'No data yet'}</span>
          )}
        </div>
        {has && chart && <div className="hidden shrink-0 sm:block">{chart}</div>}
      </div>
      {note && <p className="text-xs leading-4 text-muted">{note}</p>}
    </div>
  )
}

/** Vertical career timeline: current, next, future. Used on Dashboard and Career Path. */
export function CareerTimeline({ path, extra }: { path: CareerPath; extra?: (title: string) => ReactNode }) {
  const steps = [
    { label: 'You are here', title: path.current.title, salary: path.current.salary_range, dot: 'bg-brand-500' },
    { label: 'Next target', title: path.next.title, salary: path.next.salary_range, timeframe: path.next.timeframe, dot: 'bg-surface ring-2 ring-brand-500' },
    { label: 'Future potential', title: path.future.title, salary: path.future.salary_range, timeframe: path.future.timeframe, dot: 'bg-surface border border-dashed border-line-strong' },
  ].filter((s) => s.title?.trim()) // the model occasionally leaves a role empty
  return (
    <ol className="ml-[5px] border-l border-line">
      {steps.map((s) => (
        <li key={s.label} className="relative pb-5 pl-5 last:pb-0">
          <span className={`absolute top-1.5 -left-[5.5px] size-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
          <div className="t-overline">
            {s.label}
            {s.timeframe && <span className="t-num normal-case tracking-normal"> · {s.timeframe}</span>}
          </div>
          <div className="t-title mt-0.5">{s.title}</div>
          {s.salary && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="t-num text-[13px] text-ink">{s.salary}</span>
              <Badge>Estimated</Badge>
            </div>
          )}
          {extra && s.title && extra(s.title)}
        </li>
      ))}
    </ol>
  )
}

/* ---------- Feedback ---------- */

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-subtle ${className}`} aria-hidden="true" />
}

/** Placeholder for an AI result card while it loads. */
export function SkeletonCard({ lines = 4, label = 'Loading results' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center sm:py-12">
      <div className="mb-2 flex size-10 items-center justify-center rounded-lg border border-line bg-subtle text-muted [&_svg]:size-5">
        {icon}
      </div>
      <p className="t-title">{title}</p>
      <p className="max-w-sm text-[13px] leading-5 text-muted">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-[13px] leading-5 text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span>{message}</span>
        {isDemoLimit(message) ? (
          <div className="mt-2">
            <ButtonLink href="#settings" size="sm" variant="secondary" icon={KeyRound}>
              Add your API key
            </ButtonLink>
          </div>
        ) : (
          isModelUnavailable(message) && (
            <div className="mt-2">
              <ButtonLink href="#settings?focus=model" size="sm" variant="secondary">
                Choose another model
              </ButtonLink>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/** Muted 'Answered by <model>' line; fallback is the model that was asked for first. */
export function AnsweredBy({ model, fallbackFrom, reason }: { model: string; fallbackFrom?: string; reason?: string }) {
  return (
    <p className="text-xs text-faint">
      Answered by <span className="font-mono text-muted">{model}</span>
      {fallbackFrom && (
        <>
          {' '}
          (fell back from <span className="font-mono">{fallbackFrom}</span>: {reason || 'quota exceeded'})
        </>
      )}
    </p>
  )
}

/** Small inline note (privacy, tips). tone info|neutral|warning. */
export function Note({
  children,
  tone = 'neutral',
  icon: Icon,
  onDismiss,
}: {
  children: ReactNode
  tone?: 'neutral' | 'info' | 'warning'
  icon?: LucideIcon
  onDismiss?: () => void
}) {
  const t = { neutral: 'border-line bg-subtle text-muted', info: 'border-info-line bg-info-bg text-info', warning: 'border-accent-100 bg-warning-bg text-warning' }[tone]
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] leading-5 ${t}`}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 rounded p-0.5 opacity-70 hover:opacity-100">
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Inline prompt shown in place of AI actions when no API key is configured; a demo note when the shared model is in use. */
export function KeyNotice() {
  const key = useApiKey()
  const local = useLocalProvider()
  const demo = useDemoActive()
  if (key || local) return null
  if (demo) {
    return (
      <Note icon={Sparkles}>
        You are using the shared demo model. Add your own key for unlimited use.{' '}
        <a href="#settings" className="font-medium text-ink underline underline-offset-2">
          Open settings
        </a>
      </Note>
    )
  }
  return (
    <Note tone="warning" icon={KeyRound}>
      Add a model API key to use this tool. It stays in this browser.{' '}
      <a href="#settings" className="font-medium underline underline-offset-2">
        Open settings
      </a>
    </Note>
  )
}

/* ---------- Toast ---------- */

let toastMsg: { id: number; text: string } | null = null
const toastSubs = new Set<() => void>()
let toastTimer: ReturnType<typeof setTimeout> | undefined

/** Show a short bottom-right confirmation, e.g. toast('Copied to clipboard'). */
export function toast(text: string) {
  toastMsg = { id: Date.now(), text }
  toastSubs.forEach((f) => f())
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMsg = null
    toastSubs.forEach((f) => f())
  }, 2400)
}

/** Mounted once in App. */
export function Toaster() {
  const msg = useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb)
      return () => toastSubs.delete(cb)
    },
    () => toastMsg,
  )
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60]">
      {msg && (
        <div key={msg.id} className="flex items-center gap-2 rounded-lg border border-line bg-ink px-3 py-2 text-[13px] text-white shadow-pop">
          <Check className="size-4 text-brand-200" aria-hidden="true" />
          {msg.text}
        </div>
      )}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          toast('Could not copy. Select the text and copy manually.')
          return
        }
        setCopied(true)
        toast('Copied to clipboard')
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink"
    >
      {copied ? <Check className="size-4 text-brand-600" aria-hidden="true" /> : <Copy className="size-4" strokeWidth={1.75} aria-hidden="true" />}
    </button>
  )
}

/* ---------- Content ---------- */

export function BulletList({ items, empty = 'None noted.' }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="space-y-1.5 text-sm text-ink">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Original vs improved text, with copy on the improved version. */
export function BeforeAfter({ before, after, label }: { before: string; after: string; label?: string }) {
  return (
    <div className="space-y-2">
      {label && <div className="t-overline">{label}</div>}
      <div className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] leading-5 text-muted">{before}</div>
      <ImprovedText text={after} />
    </div>
  )
}

/** Evergreen rewrite box with a copy button pinned top-right. */
export function ImprovedText({ text, label = 'Copy improved text', className = 'text-[13px] leading-5' }: { text: string; label?: string; className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 py-2 pr-1 pl-3 text-brand-900 ${className}`}>
      <p className="min-w-0 flex-1 whitespace-pre-wrap">{text}</p>
      <CopyButton text={text} label={label} />
    </div>
  )
}

export function Avatar({ name, size = 'md' }: { name?: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'size-7 text-[11px]', md: 'size-8 text-xs', lg: 'size-12 text-base' }[size]
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 ${s}`} aria-hidden="true">
      {initials(name) ?? <UserRound className="size-[55%]" strokeWidth={1.75} />}
    </span>
  )
}

export function initials(name: string | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') : null
}

/** Explains why the adjacent action is disabled. */
export function ActionHint({ show, children }: { show: unknown; children: ReactNode }) {
  if (!show) return null
  return <p className="text-xs leading-4 text-faint">{children}</p>
}

/* ---------- Dialogs ---------- */

/** Native <dialog> shown modally while `open`. Esc and backdrop click call onClose; focus returns to the opener. */
export function Dialog({
  open,
  onClose,
  label,
  className = '',
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d || !open) return
    const opener = document.activeElement as HTMLElement | null
    d.showModal()
    // React's autoFocus fires before showModal, so focus the marked field here.
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      d.close()
      // Opener may have unmounted (e.g. the mobile drawer); fall back to main content.
      if (opener?.isConnected) opener.focus()
      else document.getElementById('main')?.focus()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-auto max-h-[85vh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-pop ${className}`}
    >
      {open && children}
    </dialog>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  /** Buttons, right-aligned. */
  footer?: ReactNode
  children: ReactNode
  width?: string
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title} className={width}>
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="t-title">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">{footer}</div>}
      </div>
    </Dialog>
  )
}
