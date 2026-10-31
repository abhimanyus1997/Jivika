import { ChevronsUpDown, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { api, type ModelInfo, type ModelList } from '../lib/api'
import { Badge, IconButton, inputCls } from './ui'

const contextLabel = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`) + ' context'
const priceLabel = (m: ModelInfo) =>
  m.input_price !== undefined && m.output_price !== undefined ? `$${m.input_price} / $${m.output_price} per 1M tokens` : ''

/**
 * Searchable model combobox (ARIA 1.2 combobox + listbox). The input is the value itself, so any text
 * is a custom model id; the list loads from the provider (debounced after the key changes, or on Refresh).
 */
export function ModelPicker({
  provider,
  providerName,
  apiKey,
  canListWithoutKey,
  fallback,
  value,
  onChange,
}: {
  provider: string
  providerName: string
  apiKey: string
  /** OpenRouter's list is public. */
  canListWithoutKey: boolean
  fallback: string
  value: string
  onChange: (model: string) => void
}) {
  const id = useId()
  const listId = `${id}-list`
  const [list, setList] = useState<(ModelList & { for: string }) | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [active, setActive] = useState(0)
  const [nonce, setNonce] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const key = apiKey.trim()
  const canList = !!key || canListWithoutKey
  const forKey = `${provider}|${key}`
  const current = list?.for === forKey ? list : null

  useEffect(() => {
    if (!canList) return
    let live = true
    const t = setTimeout(
      () => {
        setLoading(true)
        setError('')
        api
          .models(provider, key)
          .then(
            (r) => live && setList({ ...r, for: forKey }),
            (e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load models.'),
          )
          .finally(() => live && setLoading(false))
      },
      nonce ? 0 : 600,
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [provider, key, canList, forKey, nonce])

  const models = current?.models ?? []
  const recommended = current?.recommended ?? fallback
  const q = typed ? value.trim().toLowerCase() : ''
  const filtered = (q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : models).slice(0, 100)
  const custom = value.trim() && !models.some((m) => m.id === value.trim()) ? value.trim() : ''
  const options = [...filtered.map((m) => ({ id: m.id, model: m as ModelInfo | null })), ...(custom ? [{ id: custom, model: null }] : [])]
  const activeIndex = Math.min(active, options.length - 1)

  function choose(modelId: string) {
    onChange(modelId)
    setOpen(false)
    setTyped(false)
  }

  const status = !canList
    ? 'Enter an API key to load the model list.'
    : loading
      ? 'Loading models'
      : error
        ? error
        : current
          ? current.source === 'live'
            ? `Live from ${providerName} · ${models.length} models`
            : `Fallback list${current.error ? `: ${current.error}` : ''}`
          : ''

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="t-label">
          Model
        </label>
        {current && <Badge tone={current.source === 'live' ? 'brand' : 'neutral'}>{current.source === 'live' ? `Live from ${providerName}` : 'Fallback list'}</Badge>}
      </div>
      <div className="relative flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options.length ? `${listId}-${activeIndex}` : undefined}
            aria-describedby={`${id}-status`}
            className={`${inputCls} pr-8 font-mono text-[13px]`}
            value={value}
            placeholder={recommended}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              onChange(e.target.value)
              setTyped(true)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setOpen(true)
                const n = options.length
                if (n) setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
              } else if (e.key === 'Enter' && open && options[activeIndex]) {
                e.preventDefault()
                choose(options[activeIndex].id)
              } else if (e.key === 'Escape' && open) {
                e.preventDefault()
                setOpen(false)
              }
            }}
          />
          <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
          {open && options.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label={`${providerName} models`}
              className="absolute top-full right-0 left-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop"
            >
              {options.map((o, i) => {
                const m = o.model
                const meta = m ? [m.context_length && contextLabel(m.context_length), priceLabel(m)].filter(Boolean).join(' · ') : ''
                return (
                  <li
                    key={`${o.id}-${m ? 'm' : 'c'}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.id === value.trim()}
                    // mousedown keeps focus in the input so blur does not close the list first
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(o.id)
                    }}
                    onMouseMove={() => setActive(i)}
                    className={`cursor-pointer rounded-md px-2.5 py-1.5 ${i === activeIndex ? 'bg-subtle' : ''}`}
                  >
                    {m ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate font-mono text-[13px] text-ink">{m.id}</span>
                          {m.id === recommended && <Badge tone="brand">Recommended</Badge>}
                        </div>
                        {(m.name && m.name !== m.id) || meta ? (
                          <div className="truncate text-xs text-faint">{[m.name !== m.id && m.name, meta].filter(Boolean).join(' · ')}</div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-[13px] text-muted">
                        Use a custom model id: <span className="font-mono text-ink">{o.id}</span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <IconButton
          icon={RefreshCw}
          label="Refresh models"
          disabled={!canList || loading}
          className={loading ? '[&_svg]:animate-spin' : ''}
          onClick={() => setNonce((n) => n + 1)}
        />
      </div>
      <p id={`${id}-status`} role="status" className="text-xs leading-4 text-faint">
        {status ? `${status.replace(/[.\s]+$/, '')}. ` : ''}Leave blank to use {current ? 'the recommended model' : fallback}.
      </p>
    </div>
  )
}
