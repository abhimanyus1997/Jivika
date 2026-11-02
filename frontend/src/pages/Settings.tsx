import { Check, ExternalLink, Eye, EyeOff, Link2, Lock, Scissors, Server, ShieldCheck, Sparkles, Trash2, Undo2, Unlink, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CLIPPER_URL } from '../components/ClipperPromo'
import { ExportMenu } from '../components/ExportMenu'
import { ImportDialog } from '../components/ImportDialog'
import { ModelPicker } from '../components/ModelPicker'
import { ThemeToggle } from '../components/ThemeToggle'
import { Badge, Button, Card, ErrorMessage, Field, IconButton, inputCls, Modal, Note, PageHeader, ProviderIcon, toast } from '../components/ui'
import { api, FALLBACK_PROVIDERS, useAction, useDemo, type Profile, type Provider, type StructuredProfile } from '../lib/api'
import { LATEST_CLIPPER_VERSION } from '../lib/clip'
import { compareVersions, DEFAULT_ANSWERS, isChromium, ping, send, type Answers } from '../lib/clipper-bridge'
import type { ExportId } from '../lib/portability/export'
import { snapshotInfo, undoImport } from '../lib/portability/snapshot'
import { clearAll, getKey, normalizeStructured, read, saveKey, setKeyVerified, useKeyVerified, useSettings, useStored } from '../lib/store'

/** Settings row: title and description on the left, controls on the right. */
function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-line pt-6 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="t-title">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

const ALL_EXPORTS: ExportId[] = [
  'all-json',
  'all-zip',
  'all-xml',
  'profile-jsonresume',
  'profile-europass',
  'profile-jivika',
  'profile-md',
  'profile-txt',
  'applications-csv',
  'applications-json',
  'calendar-ics',
  'inbox-json',
  'jobs-json',
  'searches-json',
  'letters-json',
  'tailored-json',
  'emails-json',
]

/** Export in every format, import any supported file (button or drop anywhere on the section), and undo the last import. */
function DataTransfer({ onImport }: { onImport: () => void }) {
  const [snapshot, setSnapshot] = useState(snapshotInfo)
  return (
    <section id="data-transfer" className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h3 className="t-title">Export and import</h3>
      <p className="mt-0.5 max-w-xl text-[13px] leading-5 text-muted">
        Download your data as a Jivika backup, a ZIP bundle, JSON Resume, Europass, CSV, calendar or XML, or bring data in from Jivika, JSON Resume,
        Europass, a LinkedIn data export, a spreadsheet, a calendar or a resume. Drop a file anywhere on this section. Your API key is never included.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <ExportMenu formats={ALL_EXPORTS} label="Export" />
        <Button variant="secondary" icon={Upload} onClick={onImport}>
          Import
        </Button>
        {snapshot && (
          <Button
            variant="ghost"
            icon={Undo2}
            title={`Undo the import of ${snapshot.label}`}
            onClick={() => {
              if (undoImport()) toast('Import undone')
              setSnapshot(null)
            }}
          >
            Undo last import
          </Button>
        )}
      </div>
      {snapshot && (
        <p className="mt-2 text-xs text-faint">
          Last import: {snapshot.label}, {new Date(snapshot.at).toLocaleString()}.
        </p>
      )}
    </section>
  )
}

/** The Data and privacy section accepts a dropped file anywhere and opens the import dialog with it. */
function DataSection({ children }: { children: (openImport: () => void, version: number) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [version, setVersion] = useState(0)
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        setFile(e.dataTransfer.files[0])
        setOpen(true)
      }}
      className={`rounded-xl transition-shadow ${dragging ? 'ring-2 ring-brand-500 ring-offset-4 ring-offset-canvas' : ''}`}
    >
      {children(() => {
        setFile(null)
        setOpen(true)
      }, version)}
      <ImportDialog
        open={open}
        file={file}
        onClose={() => {
          setOpen(false)
          setFile(null)
          setVersion((n) => n + 1)
        }}
      />
    </div>
  )
}

const YES_NO = ['', 'Yes', 'No']
const ANSWER_FIELDS: { key: keyof Answers; label: string; options?: string[] }[] = [
  { key: 'notice_period', label: 'Notice period' },
  { key: 'earliest_start', label: 'Earliest start date' },
  { key: 'expected_salary', label: 'Expected salary' },
  { key: 'current_salary', label: 'Current salary' },
  { key: 'work_authorization', label: 'Work authorization' },
  { key: 'sponsorship_needed', label: 'Needs visa sponsorship', options: YES_NO },
  { key: 'willing_to_relocate', label: 'Willing to relocate', options: YES_NO },
  { key: 'how_heard', label: 'How you heard about the role' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'github', label: 'GitHub URL' },
  { key: 'portfolio', label: 'Portfolio or website' },
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'gender', label: 'Gender', options: ['Prefer not to say', 'Decline to answer', 'Female', 'Male', 'Non-binary'] },
  { key: 'ethnicity', label: 'Ethnicity', options: ['Decline to answer', 'Prefer not to say'] },
  { key: 'veteran', label: 'Veteran status', options: ['Decline to answer', 'I am not a protected veteran', 'I identify as a protected veteran'] },
  { key: 'disability', label: 'Disability status', options: ['Decline to answer', 'No, I do not have a disability', 'Yes, I have a disability'] },
]

/** The structured profile, or the simple profile's basics when no structured profile exists yet. */
function profileForClipper(): StructuredProfile | null {
  const sp = read<StructuredProfile | null>('structuredProfile', null)
  if (sp) return normalizeStructured(sp)
  const p = read<Profile | null>('profile', null)
  if (!p?.name) return null
  return normalizeStructured({
    basics: { name: p.name, headline: p.headline, email: p.email ?? '', phone: p.phone ?? '', location: p.location, linkedin: '', website: '', summary: p.summary },
  })
}

/** Settings > Jivika Clipper: find the extension, copy the profile and answers into it (Connect), or remove them (Disconnect). */
function ClipperSection() {
  const [answers, setAnswers] = useStored<Answers>('clipperAnswers', DEFAULT_ANSWERS)
  // undefined while checking, null when not found. The extension reports whether it holds a profile and since when.
  const [ext, setExt] = useState<{ version: string; syncedAt: number | null } | null | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const chromium = isChromium()

  const probe = () =>
    void ping().then((r) =>
      setExt(r?.ok ? { version: typeof r.version === 'string' ? r.version : '', syncedAt: r.connected && typeof r.syncedAt === 'number' ? r.syncedAt : null } : null),
    )
  const syncedAt = ext?.syncedAt
  useEffect(probe, [])

  async function connect() {
    setError('')
    const profile = profileForClipper()
    if (!profile) return setError('Add your profile first (Profile page), then connect.')
    const b = profile.basics
    const filled = { ...answers, linkedin: answers.linkedin || b.linkedin, portfolio: answers.portfolio || b.website }
    setBusy('connect')
    try {
      const r = await send({ type: 'jivika.sync', profile, answers: filled, appUrl: `${location.origin}${location.pathname}` })
      if (!r?.ok) throw new Error('Jivika Clipper did not accept the profile. Reload the extension and try again.')
      setExt((e) => e && { ...e, syncedAt: typeof r.syncedAt === 'number' ? r.syncedAt : Date.now() })
      toast('Profile sent to Jivika Clipper')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The profile could not be sent.')
    } finally {
      setBusy('')
    }
  }

  async function disconnect() {
    setError('')
    setBusy('disconnect')
    const r = await send({ type: 'jivika.disconnect' })
    setBusy('')
    if (!r?.ok) return setError('Jivika Clipper did not answer. Enable it and try again, or remove the extension.')
    setExt((e) => e && { ...e, syncedAt: null })
    toast('Profile removed from Jivika Clipper')
  }

  const outdated = ext && compareVersions(ext.version, LATEST_CLIPPER_VERSION) < 0
  return (
    <Section title="Jivika Clipper" description="Connect the browser extension so it can fill job applications with your profile and the answers below.">
      <div className="space-y-4">
        <Card>
          <div className="space-y-4">
            {!chromium ? (
              <Note icon={Scissors}>
                Connecting works in Chrome, Edge, Brave and other Chromium browsers. In this browser, clip jobs with the bookmarklet from the{' '}
                <a href={CLIPPER_URL} className="font-medium text-brand-600 hover:underline">
                  Clipper page
                </a>
                .
              </Note>
            ) : ext === undefined ? (
              <p role="status" className="text-[13px] text-muted">
                Looking for Jivika Clipper...
              </p>
            ) : ext === null ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-md text-[13px] leading-5 text-muted">
                  Jivika Clipper was not found in this browser. Install version {LATEST_CLIPPER_VERSION} or later (older copies cannot connect), then
                  check again.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => {
                      setExt(undefined)
                      probe()
                    }}>
                    Check again
                  </Button>
                  <a href={CLIPPER_URL} className="inline-flex h-8 items-center gap-1.5 px-1 text-sm font-medium text-brand-600 hover:underline">
                    Install <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand" dot>
                    Installed
                  </Badge>
                  <span className="t-num text-[13px] text-muted">Version {ext.version || 'unknown'}</span>
                  {syncedAt && <Badge tone="info">Connected</Badge>}
                </div>
                {outdated && (
                  <Note tone="warning">
                    A newer Jivika Clipper ({LATEST_CLIPPER_VERSION}) is available.{' '}
                    <a href={CLIPPER_URL} className="font-medium underline underline-offset-2">
                      Update it
                    </a>
                  </Note>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button icon={Link2} onClick={connect} loading={busy === 'connect'} disabled={!!busy}>
                    {syncedAt ? 'Send profile again' : 'Connect'}
                  </Button>
                  {syncedAt && (
                    <Button variant="secondary" icon={Unlink} onClick={disconnect} loading={busy === 'disconnect'} disabled={!!busy}>
                      Disconnect
                    </Button>
                  )}
                </div>
                {syncedAt && (
                  <p className="text-xs text-faint">
                    Last sent: {new Date(syncedAt).toLocaleString()}. Send it again after you change your profile or answers.
                  </p>
                )}
              </div>
            )}
            <ErrorMessage message={error} />
            <Note icon={Lock}>
              Connecting copies your structured profile and the answers below into the extension's own storage in this browser. Nothing is sent to
              Jivika's servers. The Clipper fills only the application form you choose, when you ask it to, and never submits it. Disconnect removes
              the copy.
            </Note>
          </div>
        </Card>

        <Card title="Application answers" description="Used by the Clipper for common application questions. Leave a field blank to fill it yourself.">
          <div className="grid gap-4 sm:grid-cols-2">
            {ANSWER_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                {f.options ? (
                  <select className={inputCls} value={answers[f.key] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o || 'Not set'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={inputCls}
                    value={answers[f.key] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value.slice(0, 500) })}
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>
      </div>
    </Section>
  )
}

export default function Settings() {
  const [settings, setSettings] = useSettings()
  const [providers, setProviders] = useState<Provider[]>(FALLBACK_PROVIDERS)
  const [key, setKey] = useState(getKey)
  const [show, setShow] = useState(false)
  const [verified, setVerified] = useState<{ model: string; fallbackFrom?: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const keyVerified = useKeyVerified()
  const demo = useDemo()
  const verify = useAction(api.verify)
  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0]
  const local = !!provider.local
  const usesDemo = !!demo?.enabled && !key.trim() && !local

  // #settings?focus=model (from 'Choose another model') focuses the model picker.
  useEffect(() => {
    const focus = () => {
      if (/[?&]focus=model\b/.test(location.hash)) document.querySelector<HTMLInputElement>('#model-field input')?.focus()
      if (/[?&]focus=data/.test(location.hash)) {
        const el = document.getElementById('data-transfer')
        el?.scrollIntoView({ block: 'center' })
        el?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    focus()
    window.addEventListener('hashchange', focus)
    return () => window.removeEventListener('hashchange', focus)
  }, [])

  useEffect(() => {
    api.providers().then(setProviders, () => undefined)
  }, [])

  // Persist the key as it is typed, in the storage the user chose.
  useEffect(() => saveKey(key.trim(), settings.remember), [key, settings.remember])

  function resetVerification() {
    setVerified(null)
    setKeyVerified(false)
  }

  async function runVerify() {
    resetVerification()
    const r = await verify.run()
    if (r?.demo) return
    if (r?.ok) setVerified({ model: r.model, fallbackFrom: r.fallback_from })
    setKeyVerified(!!r?.ok)
  }

  const status = !key.trim() && !local ? (
    <Badge dot>No key</Badge>
  ) : keyVerified ? (
    <Badge tone="brand" dot>
      Connected
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Not verified
    </Badge>
  )

  return (
    <>
      <PageHeader title="Settings" description="Choose your model provider and manage the data stored in this browser." />

      <div className="space-y-6">
        <Section
          title="Model provider"
          description="Jivika uses your own model API key, or a shared demo model until you add one. Pick the provider and, optionally, a specific model."
        >
          <Card>
            <div className="space-y-4">
              <fieldset>
                <legend className="t-label mb-1.5 block">Provider</legend>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {providers.map((p) => {
                    const active = p.id === provider.id
                    return (
                      <label
                        key={p.id}
                        className={`relative flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-brand-500/15 ${
                          active ? 'border-brand-500 bg-brand-50/60' : 'border-line bg-surface hover:border-line-strong'
                        }`}
                      >
                        <input
                          type="radio"
                          name="provider"
                          value={p.id}
                          checked={active}
                          className="sr-only"
                          onChange={() => {
                            // Blank model: the server picks the recommended model from the live list.
                            setSettings({ ...settings, provider: p.id, model: '' })
                            resetVerification()
                          }}
                        />
                        <ProviderIcon id={p.id} className="mt-0.5 size-[18px] text-ink" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-ink">{p.name}</span>
                            {p.local && <Badge>Local</Badge>}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-faint">{p.default_model || 'Server default'}</span>
                        </span>
                        {active && <Check className="size-4 shrink-0 text-brand-600" strokeWidth={2} aria-hidden="true" />}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {usesDemo ? (
                // Without a key every request uses the demo model, so a pick here would be ignored.
                <Field label="Model" hint={`The demo always uses ${demo.model}. Add your own ${provider.name} key to choose a model.`}>
                  <input className={`${inputCls} font-mono`} value={demo.model} readOnly aria-readonly="true" />
                </Field>
              ) : (
                <div id="model-field">
                <ModelPicker
                  provider={provider.id}
                  providerName={provider.name}
                  apiKey={key}
                  canListWithoutKey={provider.id === 'openrouter' || local}
                  fallback={provider.default_model}
                  value={settings.model}
                  onChange={(model) => {
                    setSettings({ ...settings, model })
                    resetVerification()
                  }}
                />
                </div>
              )}
              {provider.id === 'qwen' && <Note>Qwen models are also available through Groq and OpenRouter.</Note>}
              {local && (
                <Note icon={Server}>
                  {provider.name} runs on infrastructure the operator of this Jivika server configured. Requests go from the server to that model
                  server, and no API key is needed here.
                </Note>
              )}
            </div>
          </Card>
        </Section>

        <Section
          title="API key"
          description="Stored only in this browser and sent with each request to your chosen provider. The server never stores or logs it."
        >
          <div className="space-y-4">
            {demo?.enabled && !local && (
              <Note icon={Sparkles} tone={key.trim() ? 'neutral' : 'info'}>
                {key.trim() ? (
                  <>Your own key is in use. Remove it to switch back to the shared demo model.</>
                ) : (
                  <>
                    No key yet, so tools use the shared demo model ({demo.provider_name},{' '}
                    <span className="font-mono">{demo.model}</span>), limited to{' '}
                    <span className="t-num">{demo.hourly_limit}</span> runs an hour
                    {demo.remaining_hourly !== null && (
                      <>
                        {' '}
                        (<span className="t-num">{demo.remaining_hourly}</span> left)
                      </>
                    )}
                    . Add your own key below for unlimited use.
                  </>
                )}
              </Note>
            )}
            <Card title={`${provider.name} key`} action={status}>
              <div className="space-y-4">
                <Field label={local ? 'API key (optional)' : 'API key'} hint={local ? 'Only if the server expects one and the operator did not set it.' : undefined}>
                  <div className="relative">
                    <input
                      type={show ? 'text' : 'password'}
                      className={`${inputCls} pr-10 font-mono text-[13px]`}
                      value={key}
                      onChange={(e) => {
                        setKey(e.target.value)
                        resetVerification()
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={local ? 'Not needed for most local servers' : 'Paste your API key'}
                    />
                    <IconButton
                      icon={show ? EyeOff : Eye}
                      label={show ? 'Hide API key' : 'Show API key'}
                      size="sm"
                      className="absolute top-0.5 right-0.5"
                      onClick={() => setShow(!show)}
                    />
                  </div>
                </Field>
                <label className="flex items-start gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 rounded border-line-strong accent-brand-600"
                    checked={settings.remember}
                    onChange={(e) => setSettings({ ...settings, remember: e.target.checked })}
                  />
                  <span>
                    Remember key on this device
                    <span className="block text-[13px] leading-5 text-muted">
                      When unchecked, the key is kept only for this browser tab session.
                    </span>
                  </span>
                </label>
                <ErrorMessage message={verify.error} />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  {local ? (
                    <span className="text-[13px] text-muted">Configured on the server</span>
                  ) : (
                  <a
                    href={provider.key_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"
                  >
                    Get a {provider.name} API key <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  </a>
                  )}
                  <div className="flex items-center gap-3">
                    {verified && (
                      <span role="status" className="text-[13px] text-muted">
                        Answered by <span className="font-mono text-ink">{verified.model}</span>
                        {verified.fallbackFrom && (
                          <>
                            {' '}
                            (fell back from <span className="font-mono">{verified.fallbackFrom}</span>)
                          </>
                        )}
                      </span>
                    )}
                    <Button variant="primary" icon={ShieldCheck} onClick={runVerify} loading={verify.loading} disabled={!key.trim() && !local}>
                      {local ? 'Test connection' : 'Verify key'}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Appearance" description="Light, dark, or follow your system setting. Applies to the app and the website in this browser.">
          <Card>
            <ThemeToggle labeled />
          </Card>
        </Section>

        <ClipperSection />

        <DataSection>
          {(openImport, version) => (
            <Section
              title="Data and privacy"
              description="Your resume, profile, analyses and applications are kept in this browser's local storage."
            >
              <div className="space-y-4">
                <Note icon={Lock}>
                  Your key and data stay in this browser. They are sent along only when you run a tool, and no account is
                  required.
                </Note>
                <DataTransfer key={version} onImport={openImport} />
                <section className="rounded-xl border border-danger-line bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <h3 className="t-title text-danger">Clear all local data</h3>
                      <p className="mt-0.5 max-w-md text-[13px] leading-5 text-muted">
                        Removes your resume, analyses, applications and saved key from this browser. This cannot be undone.
                      </p>
                    </div>
                    <Button variant="danger" icon={Trash2} onClick={() => setConfirmClear(true)}>
                      Clear data
                    </Button>
                  </div>
                </section>
              </div>
            </Section>
          )}
        </DataSection>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all local data?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                // The extension keeps its own copy; ask it to forget the profile too.
                void send({ type: 'jivika.disconnect' }).catch(() => undefined)
                clearAll()
                setKey('')
                setVerified(null)
                setConfirmClear(false)
                toast('Local data cleared')
              }}
            >
              Clear all data
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Your resume, profile, analyses, applications and API key will be removed from this browser.
        </p>
      </Modal>
    </>
  )
}
