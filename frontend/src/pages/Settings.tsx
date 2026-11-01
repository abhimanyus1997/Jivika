import { Check, Download, ExternalLink, Eye, EyeOff, Lock, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ModelPicker } from '../components/ModelPicker'
import { ThemeToggle } from '../components/ThemeToggle'
import { Badge, Button, Card, ErrorMessage, Field, IconButton, inputCls, Modal, Note, PageHeader, ProviderIcon, toast } from '../components/ui'
import { api, FALLBACK_PROVIDERS, useAction, useDemo, type Provider } from '../lib/api'
import {
  clearAll,
  exportData,
  getKey,
  importData,
  saveKey,
  setKeyVerified,
  today,
  useKeyVerified,
  useSettings,
  validateImport,
} from '../lib/store'

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

const COUNTED: { key: string; label: string }[] = [
  { key: 'applications', label: 'Applications' },
  { key: 'tailoredResumes', label: 'Tailored resumes' },
  { key: 'matches', label: 'Saved matches' },
  { key: 'savedSearches', label: 'Saved searches' },
  { key: 'atsHistory', label: 'ATS checks' },
]

/** Item count for a stored value: list length, object size, or 1. */
const countOf = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v == null ? 0 : 1)

/** Export everything except the API key to a JSON file, and import such a file back (merge or replace). */
function DataTransfer() {
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; data: Record<string, unknown> } | null>(null)
  const [error, setError] = useState('')

  function exportAll() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `jivika-export-${today()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Downloaded ${a.download}`)
  }

  async function pick(f: File | undefined) {
    setError('')
    if (!f) return
    if (f.size > 20 * 1024 * 1024) return setError('The file is larger than 20 MB, so it is not a Jivika export.')
    let raw: unknown
    try {
      raw = JSON.parse(await f.text())
    } catch {
      return setError('The file is not valid JSON.')
    }
    const r = validateImport(raw)
    if ('error' in r) return setError(r.error)
    setPending({ name: f.name, data: r.data })
  }

  function apply(mode: 'merge' | 'replace') {
    if (!pending) return
    importData(pending.data, mode)
    setPending(null)
    toast(mode === 'merge' ? 'Data merged' : 'Data replaced')
  }

  const keys = pending ? Object.keys(pending.data) : []
  return (
    <section id="data-transfer" className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h3 className="t-title">Export and import</h3>
      <p className="mt-0.5 max-w-xl text-[13px] leading-5 text-muted">
        Download everything stored here as a JSON file, or bring it into another browser. Your API key is never included.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" icon={Download} onClick={exportAll}>
          Export all data
        </Button>
        <Button variant="secondary" icon={Upload} onClick={() => file.current?.click()}>
          Import
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {error && (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      )}
      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title="Import data"
        description={pending?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => apply('replace')}>
              Replace
            </Button>
            <Button data-autofocus onClick={() => apply('merge')}>
              Merge
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink">
            The file has <span className="t-num">{keys.length}</span> stored {keys.length === 1 ? 'item' : 'items'}.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            {COUNTED.filter((c) => keys.includes(c.key)).map((c) => (
              <div key={c.key} className="flex justify-between gap-3">
                <dt className="text-muted">{c.label}</dt>
                <dd className="t-num text-ink">{countOf(pending?.data[c.key])}</dd>
              </div>
            ))}
            {['resume', 'profile', 'structuredProfile', 'coverLetter'].filter((k) => keys.includes(k)).length > 0 && (
              <div className="col-span-2 text-muted">
                Includes{' '}
                {[
                  ['resume', 'resume'],
                  ['profile', 'profile'],
                  ['structuredProfile', 'structured profile'],
                  ['coverLetter', 'cover letter'],
                ]
                  .filter(([k]) => keys.includes(k))
                  .map(([, l]) => l)
                  .join(', ')}
                .
              </div>
            )}
          </dl>
          <p className="text-[13px] leading-5 text-muted">
            <span className="font-medium text-ink">Merge</span> keeps what is here and adds the file's entries; items with the same id are taken from the
            file. <span className="font-medium text-ink">Replace</span> deletes local data first (your API key stays).
          </p>
        </div>
      </Modal>
    </section>
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

  const status = !key.trim() ? (
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
                          <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                          <span className="block truncate font-mono text-[11px] text-faint">{p.default_model}</span>
                        </span>
                        {active && <Check className="size-4 shrink-0 text-brand-600" strokeWidth={2} aria-hidden="true" />}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {demo?.enabled && !key.trim() ? (
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
                  canListWithoutKey={provider.id === 'openrouter'}
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
            </div>
          </Card>
        </Section>

        <Section
          title="API key"
          description="Stored only in this browser and sent with each request to your chosen provider. The server never stores or logs it."
        >
          <div className="space-y-4">
            {demo?.enabled && (
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
                <Field label="API key">
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
                      placeholder="Paste your API key"
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
                  <a
                    href={provider.key_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"
                  >
                    Get a {provider.name} API key <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  </a>
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
                    <Button variant="primary" icon={ShieldCheck} onClick={runVerify} loading={verify.loading} disabled={!key.trim()}>
                      Verify key
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

        <Section
          title="Data and privacy"
          description="Your resume, profile, analyses and applications are kept in this browser's local storage."
        >
          <div className="space-y-4">
            <Note icon={Lock}>
              Your key and data stay in this browser. They are sent along only when you run a tool, and no account is
              required.
            </Note>
            <DataTransfer />
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
