import { ChevronDown, Download } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { StructuredProfile } from '../lib/api'
import { downloadFile, EXPORTS, type ExportId } from '../lib/portability/export'
import { Button, toast, type ButtonSize, type ButtonVariant } from './ui'

/** Export dropdown. Uses the native popover (light dismiss and Esc for free), placed under the button when it opens. */
export function ExportMenu({
  formats,
  label = 'Export',
  profile,
  size = 'md',
  variant = 'secondary',
}: {
  formats: ExportId[]
  label?: string
  /** Exports this profile (e.g. a tailored resume) instead of the stored one. */
  profile?: StructuredProfile
  size?: ButtonSize
  variant?: ButtonVariant
}) {
  const id = useId()
  const button = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [, rerender] = useState(0)

  function place() {
    const b = button.current?.getBoundingClientRect()
    const m = menu.current
    if (!b || !m) return
    const width = m.offsetWidth
    m.style.top = `${Math.min(b.bottom + 4, window.innerHeight - m.offsetHeight - 8)}px`
    m.style.left = `${Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8))}px`
  }

  function run(f: ExportId) {
    menu.current?.hidePopover()
    try {
      const file = EXPORTS[f].build(profile)
      downloadFile(file)
      toast(`Downloaded ${file.name}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The export failed.')
    }
  }

  const groups = [...new Set(formats.map((f) => EXPORTS[f].group))]
  return (
    <>
      <span ref={button} className="inline-flex">
      <Button
        size={size}
        variant={variant}
        icon={Download}
        aria-haspopup="menu"
        aria-controls={id}
        onClick={() => {
          rerender((n) => n + 1) // re-check which exports have data
          menu.current?.togglePopover()
        }}
      >
        {label}
        <ChevronDown className="size-3.5 text-faint" strokeWidth={1.75} aria-hidden="true" />
      </Button>
      </span>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') {
            place()
            menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
          const i = items.indexOf(document.activeElement as HTMLButtonElement)
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
        }}
        className="fixed m-0 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-pop"
      >
        {groups.map((g) => (
          <div key={g} role="group" aria-label={g} className="py-1">
            {groups.length > 1 && <p className="t-overline px-2.5 pt-1 pb-0.5">{g}</p>}
            {formats
              .filter((f) => EXPORTS[f].group === g)
              .map((f) => {
                const d = EXPORTS[f]
                const ready = (!!profile && d.group === 'Profile') || d.ready()
                return (
                  <button
                    key={f}
                    type="button"
                    role="menuitem"
                    disabled={!ready}
                    onClick={() => run(f)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block text-[13px] font-medium text-ink">{d.label}</span>
                    <span className="block text-xs text-muted">{ready ? d.hint : 'Nothing to export yet'}</span>
                  </button>
                )
              })}
          </div>
        ))}
      </div>
    </>
  )
}
