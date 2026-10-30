import { AlertCircle, Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useApiKey } from '../lib/store'

export const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-500/30 disabled:bg-slate-50'

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#4F46E5" />
      <path d="M9 21l7-11 7 11" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="21" r="2.5" fill="#10B981" />
    </svg>
  )
}

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

const variants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-indigo-700 hover:bg-indigo-50 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
}

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

const chipTones = {
  slate: 'bg-slate-100 text-slate-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-800',
  rose: 'bg-rose-50 text-rose-700',
  amber: 'bg-amber-50 text-amber-800',
}

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: keyof typeof chipTones }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${chipTones[tone]}`}>
      {children}
    </span>
  )
}

/** Score band shared by rings and bars. The label always accompanies the color. */
export function scoreBand(score: number) {
  if (score >= 75) return { label: 'Strong', stroke: '#10B981', bar: 'bg-emerald-500', text: 'text-emerald-700' }
  if (score >= 50) return { label: 'Fair', stroke: '#F59E0B', bar: 'bg-amber-500', text: 'text-amber-700' }
  return { label: 'Needs work', stroke: '#F43F5E', bar: 'bg-rose-500', text: 'text-rose-700' }
}

export function ProgressBar({ value, label, suffix = '%' }: { value: number; label: string; suffix?: string }) {
  const band = scoreBand(value)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{value}{suffix}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export function ScoreRing({ value, label, size = 128 }: { value: number; label: string; size?: number }) {
  const band = scoreBand(value)
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={`${label}: ${value} out of 100, ${band.label}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#EEF2FF" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={band.stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
        />
        <text
          x="50"
          y="50"
          transform="rotate(90 50 50)"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-slate-900 text-[22px] font-bold"
        >
          {value}
        </text>
      </svg>
      <div className="text-center">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className={`text-xs font-medium ${band.text}`}>{band.label}</div>
      </div>
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
      <div className="text-slate-400">{icon}</div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="max-w-xs text-xs text-slate-500">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorMessage({ message }: { message: string }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

/** Inline prompt shown in place of AI actions when no API key is configured. */
export function KeyNotice() {
  const key = useApiKey()
  if (key) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
      <KeyRound className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">Add your own LLM API key to use this tool. It stays in your browser.</span>
      <a href="#settings" className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900">
        Open Settings
      </a>
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
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </button>
  )
}

export function BulletList({ items, empty = 'None noted.' }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Explains why the adjacent action is disabled. */
export function ActionHint({ show, children }: { show: unknown; children: ReactNode }) {
  if (!show) return null
  return <p className="text-xs text-slate-500">{children}</p>
}

export function PageIntro({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-sm text-slate-600">{children}</p>
}
