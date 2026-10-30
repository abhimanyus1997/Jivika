import { CheckCircle2, ExternalLink, Eye, EyeOff, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, ErrorMessage, Field, inputCls, PageIntro } from '../components/ui'
import { api, FALLBACK_PROVIDERS, useAction, type Provider } from '../lib/api'
import { clearAll, getKey, saveKey, setKeyVerified, useSettings } from '../lib/store'

export default function Settings() {
  const [settings, setSettings] = useSettings()
  const [providers, setProviders] = useState<Provider[]>(FALLBACK_PROVIDERS)
  const [key, setKey] = useState(getKey)
  const [show, setShow] = useState(false)
  const [verified, setVerified] = useState('')
  const verify = useAction(api.verify)
  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0]

  useEffect(() => {
    api.providers().then(setProviders, () => undefined)
  }, [])

  // Prefill the model with the provider default the first time Settings opens.
  useEffect(() => {
    if (!settings.model) setSettings((s) => ({ ...s, model: provider.default_model }))
  }, [])

  // Persist the key as it is typed, in the storage the user chose.
  useEffect(() => saveKey(key.trim(), settings.remember), [key, settings.remember])

  async function runVerify() {
    setVerified('')
    setKeyVerified(false)
    const r = await verify.run()
    if (r?.ok) setVerified(r.model)
    setKeyVerified(!!r?.ok)
  }

  return (
    <>
      <PageIntro>
        Jivika uses your own LLM API key. It is stored only in this browser and sent with each request to your chosen
        provider. The server never stores or logs it.
      </PageIntro>

      <Card title="Model provider">
        <div className="max-w-xl space-y-4">
          <Field label="Provider">
            <select
              className={inputCls}
              value={provider.id}
              onChange={(e) => {
                const next = providers.find((p) => p.id === e.target.value)
                setSettings({ ...settings, provider: e.target.value, model: next?.default_model ?? '' })
                setVerified('')
                setKeyVerified(false)
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model" hint={`Defaults to ${provider.default_model} when left blank.`}>
            <input
              className={inputCls}
              value={settings.model}
              placeholder={provider.default_model}
              onChange={(e) => {
                setSettings({ ...settings, model: e.target.value })
                setVerified('')
                setKeyVerified(false)
              }}
              spellCheck={false}
            />
          </Field>
          <Field label="API key">
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                className={`${inputCls} pr-10 font-mono`}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value)
                  setVerified('')
                  setKeyVerified(false)
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your API key"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide API key' : 'Show API key'}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-800"
              >
                {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
          </Field>
          <a
            href={provider.key_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline"
          >
            Get a {provider.name} API key <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 accent-indigo-600"
              checked={settings.remember}
              onChange={(e) => setSettings({ ...settings, remember: e.target.checked })}
            />
            <span>
              Remember key on this device
              <span className="block text-xs text-slate-500">
                When unchecked, the key is kept only for this browser tab session.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runVerify} loading={verify.loading} disabled={!key.trim()}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              Verify key
            </Button>
            {verified && (
              <span role="status" className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Key works with {verified}
              </span>
            )}
          </div>
          <ErrorMessage message={verify.error} />
        </div>
      </Card>

      <Card title="Local data">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-slate-600">
            Your resume, profile, analyses and applications are stored in this browser only. Clearing removes them and
            your saved key. This cannot be undone.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Clear all Jivika data from this browser, including your API key?')) {
                clearAll()
                setKey('')
              }
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Clear all local data
          </Button>
        </div>
      </Card>
    </>
  )
}
