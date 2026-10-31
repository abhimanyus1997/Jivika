import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, Kbd } from './ui'

export interface Command {
  id: string
  label: string
  group: 'Pages' | 'Actions'
  icon: LucideIcon
  /** Hash to navigate to, e.g. "#applications?new". */
  href: string
  keywords?: string
}

export function useCtrlK(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  return (
    <Dialog open={open} onClose={onClose} label="Command palette" className="mt-[12vh] mb-auto max-w-xl">
      <PaletteBody onClose={onClose} commands={commands} />
    </Dialog>
  )
}

function PaletteBody({ onClose, commands }: { onClose: () => void; commands: Command[] }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? commands.filter((c) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q)) : commands
  }, [commands, query])

  useEffect(() => {
    const c = results[active]
    if (c) document.getElementById(`cmd-${c.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  function go(c: Command | undefined) {
    if (!c) return
    onClose()
    location.hash = c.href
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
        <input
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = results.length
              if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault()
              setActive(e.key === 'Home' ? 0 : Math.max(0, results.length - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              go(results[active])
            }
          }}
          placeholder="Search pages and actions"
          aria-label="Search pages and actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div id="palette-list" role="listbox" aria-label="Results" className="max-h-[360px] overflow-y-auto p-2">
        {results.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-muted">No matches for "{query}".</p>}
        {(['Pages', 'Actions'] as const).map((group) => {
          const items = results.filter((c) => c.group === group)
          if (!items.length) return null
          return (
            <div key={group} role="group" aria-label={group} className="mb-1 last:mb-0">
              <div className="t-overline px-2.5 pt-2 pb-1">{group}</div>
              {items.map((c) => {
                const i = results.indexOf(c)
                const selected = i === active
                return (
                  <div
                    key={c.id}
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(c)}
                    className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm ${
                      selected ? 'bg-subtle text-ink' : 'text-muted'
                    }`}
                  >
                    <c.icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex-1 truncate">{c.label}</span>
                    {selected && <CornerDownLeft className="size-3.5 text-faint" aria-hidden="true" />}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="hidden items-center gap-3 border-t border-line bg-canvas px-4 py-2 text-xs text-faint md:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> to open
        </span>
      </div>
    </div>
  )
}
