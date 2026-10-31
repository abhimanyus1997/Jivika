import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { SQLite, sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup, EditorView } from 'codemirror'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CodingLanguage } from '../../lib/api'

const LANGS: Record<CodingLanguage, () => ReturnType<typeof python>> = {
  python: () => python(),
  javascript: () => javascript(),
  sql: () => sql({ dialect: SQLite, upperCaseKeywords: true }),
}

// Chrome from the design tokens, so the editor follows light and dark like the rest of the app.
// Dark mode adds One Dark's syntax colours; light keeps CodeMirror's default highlighting.
const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: '13px', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--color-ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ink)' },
  '.cm-gutters': { backgroundColor: 'var(--color-canvas)', color: 'var(--color-faint)', borderRight: '1px solid var(--color-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-subtle) 60%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-brand-100) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--color-brand-100)', color: 'var(--color-ink)' },
  '.cm-panels': { backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' },
})

const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function useResolvedTheme() {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const update = () => setTheme(currentTheme())
    window.addEventListener('jivika-theme', update)
    return () => window.removeEventListener('jivika-theme', update)
  }, [])
  return theme
}

/** CodeMirror 6 editor (default export so it can be lazy-loaded). Recreated when the language or theme changes; Ctrl/Cmd+Enter calls onRun. */
export default function CodeEditor({
  value,
  onChange,
  lang,
  label,
  onRun,
}: {
  value: string
  onChange: (value: string) => void
  lang: CodingLanguage
  label: string
  onRun?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ value, onChange })
  useLayoutEffect(() => {
    latest.current = { value, onChange }
  })
  const theme = useResolvedTheme()

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      doc: latest.current.value,
      extensions: [
        chrome,
        basicSetup,
        LANGS[lang](),
        ...(theme === 'dark' ? [oneDark] : []),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(u.state.doc.toString())
        }),
      ],
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [lang, theme, label])

  // Outside changes (reset, language switch restoring a draft) replace the document.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return (
    <div
      ref={host}
      className="h-[min(60vh,520px)] min-h-72 overflow-hidden rounded-lg border border-line [&_.cm-editor]:h-full"
      onKeyDown={(e) => {
        if (onRun && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          onRun()
        }
      }}
    />
  )
}
