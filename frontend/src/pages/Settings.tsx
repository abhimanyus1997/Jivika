import { Check, ExternalLink, Eye, EyeOff, Lock, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Button, Card, ErrorMessage, Field, IconButton, inputCls, Modal, Note, PageHeader, ProviderIcon, toast } from '../components/ui'
import { api, FALLBACK_PROVIDERS, useAction, useDemo, type Provider } from '../lib/api'
import { clearAll, getKey, saveKey, setKeyVerified, useKeyVerified, useSettings } from '../lib/store'

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

export default function Settings() {
  const [settings, setSettings] = useSettings()
  const [providers, setProviders] = useState<Provider[]>(FALLBACK_PROVIDERS)
  const [key, setKey] = useState(getKey)
  const [show, setShow] = useState(false)
  const [verified, setVerified] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const keyVerified = useKeyVerified()
  const demo = useDemo()
  const verify = useAction(api.verify)
  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0]

  useEffect(() => {
    api.providers().then(setProviders, () => undefined)
  }, [])

  // Persist the key as it is typed, in the storage the user chose.
  useEffect(() => saveKey(key.trim(), settings.remember), [key, settings.remember])

  function resetVerification() {
    setVerified('')
    setKeyVerified(false)
  }

  async function runVerify() {
    resetVerification()
    const r = await verify.run()
    if (r?.demo) return
    if (r?.ok) setVerified(r.model)
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
                            setSettings({ ...settings, provider: p.id, model: p.default_model })
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
              <Field label="Model" hint={`Defaults to ${provider.default_model} when left blank.`}>
                <input
                  className={`${inputCls} font-mono text-[13px]`}
                  value={settings.model}
                  placeholder={provider.default_model}
                  onChange={(e) => {
                    setSettings({ ...settings, model: e.target.value })
                    resetVerification()
                  }}
                  spellCheck={false}
                />
              </Field>
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
                        Works with <span className="font-mono text-ink">{verified}</span>
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

        <Section
          title="Data and privacy"
          description="Your resume, profile, analyses and applications are kept in this browser's local storage."
        >
          <div className="space-y-4">
            <Note icon={Lock}>
              Your key and data stay in this browser. They are sent along only when you run a tool, and no account is
              required.
            </Note>
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
                setVerified('')
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
