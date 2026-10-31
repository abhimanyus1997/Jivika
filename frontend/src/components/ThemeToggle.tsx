import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

// Provided by public/theme.js, which runs in <head> before first paint.
declare global {
  interface Window {
    jivikaTheme?: { get(): ThemePreference; set(pref: ThemePreference): void }
  }
}

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const subscribe = (cb: () => void) => {
  window.addEventListener('jivika-theme', cb)
  return () => window.removeEventListener('jivika-theme', cb)
}
const getPreference = (): ThemePreference => window.jivikaTheme?.get() ?? 'system'

/** Current theme preference, kept in sync across components and tabs. */
export function useThemePreference() {
  return useSyncExternalStore(subscribe, getPreference, () => 'system' as ThemePreference)
}

/**
 * Light / Dark / System segmented control. Icon-only by default (top bar); `labeled` shows text (Settings).
 */
export function ThemeToggle({ labeled = false, className = '' }: { labeled?: boolean; className?: string }) {
  const pref = useThemePreference()
  return (
    <div role="group" aria-label="Theme" className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-subtle p-0.5 ${className}`}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = value === pref
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={labeled ? undefined : `${label} theme`}
            title={labeled ? undefined : `${label} theme`}
            onClick={() => window.jivikaTheme?.set(value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 ${
              labeled ? 'h-7 px-2.5 text-[13px]' : 'size-6'
            } ${active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-muted hover:text-ink'}`}
          >
            <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {labeled && label}
          </button>
        )
      })}
    </div>
  )
}
