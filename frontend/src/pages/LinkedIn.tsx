import { Contact } from 'lucide-react'
import { BulletList, Button, Card, Chip, CopyButton, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ActionHint, ScoreRing } from '../components/ui'
import { api, useAction } from '../lib/api'
import { pushHistory, useApiKey, useLinkedInReview, useProfile, useStored } from '../lib/store'

export default function LinkedIn() {
  const [profile] = useProfile()
  const [form, setForm] = useStored('linkedinInput', { headline: profile?.headline ?? '', about: '', experience: '' })
  const [review, setReview] = useLinkedInReview()
  const key = useApiKey()
  const action = useAction(api.linkedin)

  async function run() {
    const r = await action.run({
      headline: form.headline.trim(),
      about: form.about.trim(),
      experience: form.experience.trim() || undefined,
    })
    if (r) {
      setReview(r)
      pushHistory('linkedin', r.score)
    }
  }

  return (
    <>
      <PageIntro>Paste your LinkedIn headline and About section to get a profile health score and rewrites you can copy.</PageIntro>
      <Card>
        <div className="space-y-4">
          <Field label="Headline">
            <input className={inputCls} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          </Field>
          <Field label="About">
            <textarea className={`${inputCls} h-36`} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} />
          </Field>
          <Field label="Experience" hint="Optional. Paste your most recent roles for more specific suggestions.">
            <textarea className={`${inputCls} h-28`} value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} />
          </Field>
          <KeyNotice />
          <ErrorMessage message={action.error} />
          <Button onClick={run} loading={action.loading} disabled={!key || (!form.headline.trim() && !form.about.trim())}>
            <Contact className="size-4" aria-hidden="true" />
            Review profile
          </Button>
          <ActionHint show={key && !form.headline.trim() && !form.about.trim()}>Add a headline or an About section to continue.</ActionHint>
        </div>
      </Card>

      {!review ? (
        <Card>
          <EmptyState icon={<Contact className="size-8" />} title="No review yet" text="Your LinkedIn health score and suggestions will appear here." />
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="flex items-center justify-center">
              <ScoreRing value={review.score} label="LinkedIn health" size={160} />
            </Card>
            <Card title="Headline suggestions" className="lg:col-span-2">
              <ul className="space-y-2">
                {review.headline_suggestions.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-800">
                    <span className="flex-1">{h}</span>
                    <CopyButton text={h} label="Copy headline" />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="About rewrite" action={<CopyButton text={review.about_rewrite} label="Copy About section" />}>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{review.about_rewrite}</p>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Keywords to add">
              <div className="flex flex-wrap gap-1.5">
                {review.keyword_suggestions.map((k) => (
                  <Chip key={k} tone="indigo">
                    {k}
                  </Chip>
                ))}
              </div>
            </Card>
            <Card title="Tips">
              <BulletList items={review.tips} />
            </Card>
          </div>
        </>
      )}
    </>
  )
}
