import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Contact,
  FileCheck2,
  FileUser,
  FilePlus2,
  Inbox as InboxIcon,
  LayoutDashboard,
  Mail,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Play,
  Route,
  ScanText,
  Search,
  SearchCheck,
  Settings as SettingsIcon,
  Target,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { needsAnswerCount, useInbox } from './lib/inbox'
import { FALLBACK_PROVIDERS, loadDemo, useAnswered, useDemoActive, useLocalProvider } from './lib/api'
import { receiveClip } from './lib/clip'
import { useApiKey, useKeyVerified, useProfile, useSettings, useStored } from './lib/store'
import { AnsweredBy, Avatar, Badge, Dialog, Logo, ProviderIcon, ShortcutHint, Toaster } from './components/ui'
import { CommandPalette, useCtrlK, type Command } from './components/CommandPalette'
import { ThemeToggle } from './components/ThemeToggle'
import Dashboard from './pages/Dashboard'
import ProfilePage from './pages/Profile'
import JobMatch from './pages/JobMatch'
import CvReview from './pages/CvReview'
import LinkedIn from './pages/LinkedIn'
import CareerPathPage from './pages/CareerPath'
import Interview from './pages/Interview'
import CoverLetter from './pages/CoverLetter'
import Applications from './pages/Applications'
import ResumePage from './pages/Resume'
import Ats from './pages/Ats'
import JobSearch from './pages/JobSearch'
import Settings from './pages/Settings'
import NewApplication from './pages/NewApplication'
import ApplicationPage from './pages/ApplicationPage'
import InboxPage from './pages/Inbox'
import CalendarPage from './pages/Calendar'

/** hidden pages are reachable by hash but not listed in the sidebar or the command palette. */
type Page = { id: string; title: string; icon: LucideIcon; component: ComponentType; group: string; hidden?: boolean }

const PAGES: Page[] = [
  { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, component: Dashboard, group: 'Overview' },
  { id: 'profile', title: 'Profile', icon: UserRound, component: ProfilePage, group: 'Workspace' },
  { id: 'jobs', title: 'Job search', icon: SearchCheck, component: JobSearch, group: 'Workspace' },
  { id: 'resume', title: 'Resume', icon: FileUser, component: ResumePage, group: 'Workspace' },
  { id: 'applications', title: 'Applications', icon: BriefcaseBusiness, component: Applications, group: 'Workspace' },
  { id: 'inbox', title: 'Inbox', icon: InboxIcon, component: InboxPage, group: 'Workspace' },
  { id: 'calendar', title: 'Calendar', icon: CalendarDays, component: CalendarPage, group: 'Workspace' },
  { id: 'match', title: 'Job match', icon: Target, component: JobMatch, group: 'Analyze' },
  { id: 'ats', title: 'ATS checker', icon: ScanText, component: Ats, group: 'Analyze' },
  { id: 'cv', title: 'CV review', icon: FileCheck2, component: CvReview, group: 'Analyze' },
  { id: 'linkedin', title: 'LinkedIn', icon: Contact, component: LinkedIn, group: 'Analyze' },
  { id: 'career', title: 'Career path', icon: Route, component: CareerPathPage, group: 'Plan' },
  { id: 'interview', title: 'Interview prep', icon: MessagesSquare, component: Interview, group: 'Plan' },
  { id: 'cover-letter', title: 'Cover letter', icon: Mail, component: CoverLetter, group: 'Plan' },
  { id: 'settings', title: 'Settings', icon: SettingsIcon, component: Settings, group: 'System' },
  { id: 'new-application', title: 'New application', icon: Plus, component: NewApplication, group: 'Workspace', hidden: true },
  { id: 'application', title: 'Application', icon: BriefcaseBusiness, component: ApplicationPage, group: 'Workspace', hidden: true },
]
const GROUPS = ['Overview', 'Workspace', 'Analyze', 'Plan']

const COMMANDS: Command[] = [
  ...PAGES.filter((p) => !p.hidden).map((p) => ({ id: p.id, label: p.title, group: 'Pages' as const, icon: p.icon, href: `#${p.id}` })),
  { id: 'a-new', label: 'New application', group: 'Actions', icon: Plus, href: '#new-application', keywords: 'apply start job posting tailor' },
  { id: 'a-inbox', label: 'Open inbox', group: 'Actions', icon: InboxIcon, href: '#inbox', keywords: 'email recruiter reply message' },
  { id: 'a-calendar', label: 'Open calendar', group: 'Actions', icon: CalendarDays, href: '#calendar', keywords: 'interview follow up deadline ics schedule' },
  { id: 'a-upload', label: 'Upload resume', group: 'Actions', icon: Upload, href: '#profile', keywords: 'cv pdf' },
  { id: 'a-add', label: 'Add application', group: 'Actions', icon: FilePlus2, href: '#applications?new', keywords: 'track job' },
  { id: 'a-resume', label: 'Download resume PDF', group: 'Actions', icon: FileUser, href: '#resume', keywords: 'cv theme print tailor' },
  { id: 'a-export', label: 'Export all data', group: 'Actions', icon: SettingsIcon, href: '#settings?focus=data', keywords: 'backup import json' },
  { id: 'a-jobs', label: 'Search jobs', group: 'Actions', icon: SearchCheck, href: '#jobs', keywords: 'find listings openings roles' },
  { id: 'a-match', label: 'Run job match', group: 'Actions', icon: Play, href: '#match', keywords: 'analyze description import link url' },
  { id: 'a-ats', label: 'Check ATS score', group: 'Actions', icon: ScanText, href: '#ats', keywords: 'applicant tracking resume keywords' },
  { id: 'a-settings', label: 'Open settings', group: 'Actions', icon: SettingsIcon, href: '#settings', keywords: 'api key model' },
]

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Page id from "#id" or "#id?param". */
const usePageId = () => useSyncExternalStore(subscribeHash, () => location.hash.slice(1).split('?')[0] || 'dashboard')

function useIsWide(minPx = 1024) {
  const query = `(min-width: ${minPx}px)`
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
  )
}

/* ---------- Key status ---------- */

const KEY_STATES = {
  connected: { dot: 'bg-brand-500', label: 'Connected' },
  unverified: { dot: 'bg-accent-500', label: 'Not verified' },
  demo: { dot: 'bg-info', label: 'Demo' },
  none: { dot: 'bg-faint', label: 'No key' },
  local: { dot: 'bg-brand-500', label: 'Local' },
}

function useKeyState() {
  const key = useApiKey()
  const verified = useKeyVerified()
  const demo = useDemoActive()
  const answered = useAnswered()
  const [settings] = useSettings()
  const local = useLocalProvider()
  if (demo) {
    return {
      ...KEY_STATES.demo,
      providerId: demo.provider,
      provider: `Demo · ${demo.provider_name}`,
      model: answered?.model ?? demo.preferred_model ?? demo.model,
      remaining: demo.remaining_hourly,
    }
  }
  const provider = FALLBACK_PROVIDERS.find((p) => p.id === settings.provider)
  const state = local ? 'local' : !key ? 'none' : verified ? 'connected' : 'unverified'
  return {
    ...KEY_STATES[state],
    providerId: settings.provider,
    provider: provider?.name ?? settings.provider,
    model: settings.model || provider?.default_model || 'Default model',
    remaining: null,
  }
}

/** Shows which model produced the last AI result on this page. */
function AnsweredNote({ page }: { page: string }) {
  const a = useAnswered()
  // Settings shows its own verify result.
  return a && a.page === page && page !== 'settings' ? <AnsweredBy {...a} /> : null
}

function KeyPill() {
  const s = useKeyState()
  return (
    <a
      href="#settings"
      aria-label={`Model key: ${s.label}, ${s.provider}. Open settings`}
      title={`${s.provider}: ${s.label}`}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-xs font-medium text-muted hover:bg-subtle hover:text-ink"
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      <ProviderIcon id={s.providerId} className="size-3.5 text-ink" />
      {s.label}
    </a>
  )
}

function ModelCard({ compact }: { compact: boolean }) {
  const s = useKeyState()
  if (compact) {
    return (
      <a
        href="#settings"
        title={`${s.provider}, ${s.model}: ${s.label}`}
        aria-label={`Model: ${s.provider}, ${s.label}. Open settings`}
        className="relative mx-auto flex size-8 items-center justify-center rounded-lg text-ink hover:bg-subtle"
      >
        <ProviderIcon id={s.providerId} />
        <span className={`absolute right-1 bottom-1 size-1.5 rounded-full ring-2 ring-surface ${s.dot}`} aria-hidden="true" />
      </a>
    )
  }
  return (
    <a href="#settings" className="block rounded-lg border border-line bg-canvas px-3 py-2.5 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <span className="t-overline">Model</span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
          {s.label}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <ProviderIcon id={s.providerId} />
        <span className="truncate">{s.provider}</span>
      </div>
      <div className="truncate font-mono text-[11px] text-faint">{s.model}</div>
      <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] leading-4 text-faint">
        {s.remaining !== null && s.remaining !== undefined ? (
          <>
            <span className="t-num text-muted">{s.remaining}</span> demo {s.remaining === 1 ? 'run' : 'runs'} left this hour.
          </>
        ) : s.label === 'Demo' ? (
          'Shared demo model. Add your key for unlimited use.'
        ) : (
          'Your key and data stay in this browser.'
        )}
      </div>
    </a>
  )
}

/* ---------- Sidebar ---------- */

function NavItem({ page, active, compact, onNavigate, badge = 0 }: { page: Page; active: boolean; compact: boolean; onNavigate?: () => void; badge?: number }) {
  const Icon = page.icon
  const badgeLabel = badge ? `${page.title}, ${badge} ${badge === 1 ? 'email needs' : 'emails need'} an answer` : undefined
  return (
    <a
      href={`#${page.id}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={badgeLabel ?? (compact ? page.title : undefined)}
      title={compact ? (badgeLabel ?? page.title) : undefined}
      className={`relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ${
        compact ? 'justify-center' : ''
      } ${active ? 'bg-subtle font-medium text-ink' : 'text-muted hover:bg-subtle hover:text-ink'}`}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r bg-brand-500" aria-hidden="true" />}
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {!compact && <span className="flex-1 truncate">{page.title}</span>}
      {badge > 0 &&
        (compact ? (
          <span className="absolute top-1 right-1 size-2 rounded-full bg-accent-500 ring-2 ring-surface" aria-hidden="true" />
        ) : (
          <span className="t-num rounded-full bg-accent-50 px-1.5 text-[11px] leading-[18px] font-medium text-accent-700" aria-hidden="true">
            {badge}
          </span>
        ))}
    </a>
  )
}

function Sidebar({
  current,
  compact,
  onSearch,
  onNavigate,
  footer,
}: {
  current: string
  compact: boolean
  onSearch: () => void
  onNavigate?: () => void
  footer?: ReactNode
}) {
  const settings = PAGES.find((p) => p.id === 'settings')!
  const [inbox] = useInbox()
  const unanswered = needsAnswerCount(inbox)
  return (
    <div className="flex h-full flex-col">
      <a href="#dashboard" onClick={onNavigate} className={`flex h-[52px] shrink-0 items-center gap-2.5 px-4 ${compact ? 'justify-center px-0' : ''}`}>
        <Logo className="size-6 shrink-0" />
        {!compact && (
          <>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Jivika</span>
            <Badge>Personal</Badge>
          </>
        )}
      </a>

      <div className="space-y-2 px-3 pb-2">
        <a
          href="#new-application"
          onClick={onNavigate}
          aria-current={current === 'new-application' ? 'page' : undefined}
          aria-label={compact ? 'New application' : undefined}
          title={compact ? 'New application' : undefined}
          className={`flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-700 ${
            compact ? 'px-0' : ''
          }`}
        >
          <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {!compact && <span>New application</span>}
        </a>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search or jump to"
          title={compact ? 'Search or jump to' : undefined}
          className={`flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-[13px] text-faint transition-colors duration-150 hover:border-line-strong hover:text-muted ${
            compact ? 'justify-center px-0' : ''
          }`}
        >
          <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {!compact && (
            <>
              <span className="flex-1 text-left">Search or jump to</span>
              <span className="hidden md:inline-flex">
                <ShortcutHint />
              </span>
            </>
          )}
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-3">
        {GROUPS.map((g, gi) => (
          <div key={g} className="mt-3">
            {compact ? (
              gi > 0 && <div className="mx-2 mb-2 border-t border-line" aria-hidden="true" />
            ) : (
              <div className="t-overline px-2.5 pb-1">{g}</div>
            )}
            <div className="space-y-0.5">
              {PAGES.filter((p) => p.group === g && !p.hidden).map((p) => (
                <NavItem
                  key={p.id}
                  page={p}
                  active={p.id === current || (p.id === 'applications' && current === 'application')}
                  compact={compact}
                  onNavigate={onNavigate}
                  badge={p.id === 'inbox' ? unanswered : 0}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <NavItem page={settings} active={current === 'settings'} compact={compact} onNavigate={onNavigate} />
        <ModelCard compact={compact} />
        <a
          href={import.meta.env.BASE_URL}
          aria-label={compact ? 'Back to site' : undefined}
          title={compact ? 'Back to site' : undefined}
          className={`flex h-7 items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-faint transition-colors duration-150 hover:bg-subtle hover:text-ink ${compact ? 'justify-center' : ''}`}
        >
          <ArrowLeft className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {!compact && <span>Back to site</span>}
        </a>
        {footer}
      </div>
    </div>
  )
}

/* ---------- App ---------- */

export default function App() {
  const pageId = usePageId()
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0]
  const [collapsed, setCollapsed] = useStored('sidebarCollapsed', false)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const wide = useIsWide()
  const wideMd = useIsWide(768)
  const [profile] = useProfile()
  const compact = !wide || collapsed
  const PageComponent = page.component
  const openPalette = useCallback(() => {
    setDrawer(false)
    setPalette(true)
  }, [])
  useCtrlK(openPalette)
  useEffect(loadDemo, [])
  useEffect(() => {
    const onHash = () => void receiveClip()
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = `${page.title} - Jivika`
    window.scrollTo(0, 0)
  }, [page])

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Icon rail on md, full sidebar on lg (collapsible). */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 border-r border-line bg-surface md:block ${compact ? 'w-[60px]' : 'w-[248px]'}`}>
        <Sidebar
          current={page.id}
          compact={compact}
          onSearch={openPalette}
          footer={
            wide && (
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-faint transition-colors duration-150 hover:bg-subtle hover:text-ink ${
                  compact ? 'justify-center' : ''
                }`}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4" strokeWidth={1.75} aria-hidden="true" />
                )}
                {!compact && <span>Collapse</span>}
              </button>
            )
          }
        />
      </aside>

      {/* Mobile drawer. Native dialog gives focus trap, Esc, backdrop close and focus return. */}
      <Dialog
        open={drawer && !wideMd}
        onClose={() => setDrawer(false)}
        label="Navigation"
        className="m-0! h-full! max-h-none! w-[272px]! max-w-none! rounded-none! border-y-0 border-l-0"
      >
        <div className="relative h-full">
          <button
            type="button"
            onClick={() => setDrawer(false)}
            aria-label="Close navigation"
            className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <Sidebar current={page.id} compact={false} onSearch={openPalette} onNavigate={() => setDrawer(false)} />
        </div>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-sm md:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink md:hidden"
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
            <a href="#dashboard" className="text-muted hover:text-ink">
              Jivika
            </a>
            <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            {page.id === 'application' && (
              <>
                <a href="#applications" className="text-muted hover:text-ink">
                  Applications
                </a>
                <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              </>
            )}
            <span aria-current="page" className="truncate font-medium text-ink">
              {page.title}
            </span>
          </nav>
          <button
            type="button"
            onClick={openPalette}
            className="hidden h-7 items-center gap-2 rounded-md border border-line bg-surface pr-1 pl-2 text-xs text-faint hover:bg-subtle hover:text-muted sm:inline-flex"
          >
            <Search className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Search
            <ShortcutHint />
          </button>
          <ThemeToggle className="shrink-0" />
          <KeyPill />
          <a href="#profile" aria-label="Profile" title={profile?.name || 'Profile'} className="rounded-full">
            <Avatar name={profile?.name} size="sm" />
          </a>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 px-6 py-6 outline-none md:px-8 md:py-8">
          <PageComponent />
          <AnsweredNote page={pageId} />
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={COMMANDS} />
      <Toaster />
    </div>
  )
}
