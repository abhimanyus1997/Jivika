import {
  FileCheck2,
  KanbanSquare,
  LayoutDashboard,
  Contact,
  Mail,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Settings as SettingsIcon,
  Target,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { FALLBACK_PROVIDERS } from './lib/api'
import { useApiKey, useKeyVerified, useProfile, useSettings, useStored } from './lib/store'
import { Logo } from './components/ui'
import Dashboard from './pages/Dashboard'
import ProfilePage from './pages/Profile'
import JobMatch from './pages/JobMatch'
import CvReview from './pages/CvReview'
import LinkedIn from './pages/LinkedIn'
import CareerPathPage from './pages/CareerPath'
import Interview from './pages/Interview'
import CoverLetter from './pages/CoverLetter'
import Applications from './pages/Applications'
import Settings from './pages/Settings'

const PAGES = [
  { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, component: Dashboard },
  { id: 'profile', title: 'Profile', icon: UserRound, component: ProfilePage },
  { id: 'match', title: 'Job Match', icon: Target, component: JobMatch },
  { id: 'cv', title: 'CV Review', icon: FileCheck2, component: CvReview },
  { id: 'linkedin', title: 'LinkedIn', icon: Contact, component: LinkedIn },
  { id: 'career', title: 'Career Path', icon: Route, component: CareerPathPage },
  { id: 'interview', title: 'Interview Prep', icon: MessagesSquare, component: Interview },
  { id: 'cover-letter', title: 'Cover Letter', icon: Mail, component: CoverLetter },
  { id: 'applications', title: 'Applications', icon: KanbanSquare, component: Applications },
  { id: 'settings', title: 'Settings', icon: SettingsIcon, component: Settings },
] satisfies { id: string; title: string; icon: ComponentType<{ className?: string }>; component: ComponentType }[]

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

const usePageId = () => useSyncExternalStore(subscribeHash, () => location.hash.slice(1) || 'dashboard')

function Nav({ current, compact, onNavigate }: { current: string; compact: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3">
      {PAGES.map(({ id, title, icon: Icon }) => {
        const active = id === current
        return (
          <a
            key={id}
            href={`#${id}`}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            aria-label={compact ? title : undefined}
            title={compact ? title : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              compact ? 'justify-center' : ''
            } ${active ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {!compact && <span>{title}</span>}
          </a>
        )
      })}
    </nav>
  )
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <a href="#dashboard" className={`flex items-center gap-3 px-5 py-6 ${compact ? 'justify-center px-0' : ''}`}>
      <Logo className="size-9 shrink-0" />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-lg font-bold tracking-tight text-white">Jivika</span>
          <span className="block text-xs text-slate-400">AI platform for job seekers</span>
        </span>
      )}
    </a>
  )
}

function useIsWide() {
  const query = '(min-width: 1024px)'
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
  )
}

const KEY_STATES = {
  connected: { pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', short: 'Connected' },
  unverified: { pill: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500', short: 'Not verified' },
  none: { pill: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', short: 'No key' },
}

function KeyStatus() {
  const key = useApiKey()
  const verified = useKeyVerified()
  const [settings] = useSettings()
  const name = FALLBACK_PROVIDERS.find((p) => p.id === settings.provider)?.name ?? settings.provider
  const state = !key ? 'none' : verified ? 'connected' : 'unverified'
  const full = { connected: `Connected: ${name}`, unverified: 'Key not verified', none: 'No key' }[state]
  const s = KEY_STATES[state]
  return (
    <a
      href="#settings"
      aria-label={`${full}. Open Settings`}
      title={full}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${s.pill}`}
    >
      <span className={`size-2 rounded-full ${s.dot}`} aria-hidden="true" />
      <span className="sm:hidden">{s.short}</span>
      <span className="hidden sm:inline">{full}</span>
    </a>
  )
}

function initials(name: string | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('') : null
}

export default function App() {
  const pageId = usePageId()
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]
  const [collapsed, setCollapsed] = useStored('sidebarCollapsed', false)
  const [drawer, setDrawer] = useState(false)
  const wide = useIsWide()
  const [profile] = useProfile()
  const compact = !wide || collapsed
  const Page = page.component

  useEffect(() => {
    document.title = `${page.title} - Jivika`
    window.scrollTo(0, 0)
  }, [page])

  useEffect(() => {
    if (!drawer) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer])

  return (
    <div className="flex min-h-screen">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop: icon rail on md, full sidebar on lg (collapsible). */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-ink md:flex ${compact ? 'w-[76px]' : 'w-64'}`}
      >
        <Brand compact={compact} />
        <Nav current={page.id} compact={compact} />
        {wide && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`m-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-slate-100 ${compact ? 'justify-center' : ''}`}
          >
            {collapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
            {!compact && <span>Collapse</span>}
          </button>
        )}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <aside className="relative flex h-full w-72 flex-col bg-ink">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-6 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <Brand compact={false} />
            <Nav current={page.id} compact={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/60 bg-white/70 px-4 py-3 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <h1 className="flex-1 truncate text-lg font-semibold text-slate-900">{page.title}</h1>
          <KeyStatus />
          <a
            href="#profile"
            aria-label="Profile"
            className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
          >
            {initials(profile?.name) ?? <UserRound className="size-4" aria-hidden="true" />}
          </a>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 outline-none md:p-8">
          <Page />
        </main>
        <footer className="px-4 pb-6 text-center text-xs text-slate-500 md:px-8">
          Jivika runs on your own API key. Your data stays in this browser.
        </footer>
      </div>
    </div>
  )
}

