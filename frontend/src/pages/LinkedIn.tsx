import { Contact } from 'lucide-react'
import {
  ActionHint,
  Badge,
  BulletList,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorMessage,
  ImprovedText,
  Field,
  inputCls,
  KeyNotice,
  PageHeader,
  ScoreRing,
  scoreBand,
  SkeletonCard,
  textareaCls,
} from '../components/ui'
import { api, useAction, type LinkedInReview } from '../lib/api'
import { pushHistory, useApiKey, useLinkedInReview, useProfile, useStored } from '../lib/store'

export default function LinkedIn() {
  const [profile] = useProfile()
  const [form, setForm] = useStored('linkedinInput', { headline: profile?.headline ?? '', about: '', experience: '' })
  const [review, setReview] = useLinkedInReview()
  const key = useApiKey()
  const action = useAction(api.linkedin)
  const empty = !form.headline.trim() && !form.about.trim()

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
      <PageHeader title="LinkedIn" description="Get a profile health score, plus headline and About rewrites you can copy." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
          <Card title="Your profile" description="Paste sections from your LinkedIn profile.">
            <div className="space-y-4">
              <Field label="Headline">
                <input className={inputCls} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
              </Field>
              <Field label="About">
                <textarea className={`${textareaCls} min-h-36`} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} />
              </Field>
              <Field label="Experience" hint="Optional. Paste your most recent roles for more specific suggestions.">
                <textarea className={`${textareaCls} min-h-28`} value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} />
              </Field>
              <KeyNotice />
              <ErrorMessage message={action.error} />
              <Button variant="brand" icon={Contact} onClick={run} loading={action.loading} disabled={!key || empty} className="w-full">
                {review ? 'Review again' : 'Review profile'}
              </Button>
              <ActionHint show={key && empty}>Add a headline or an About section to continue.</ActionHint>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {action.loading ? (
            <>
              <SkeletonCard lines={3} label="Reviewing your profile" />
              <SkeletonCard lines={5} label="Writing suggestions" />
            </>
          ) : !review ? (
            <Card>
              <EmptyState icon={<Contact strokeWidth={1.75} />} title="No review yet" text="Your LinkedIn health score and suggestions will appear here." />
            </Card>
          ) : (
            <Results review={review} />
          )}
        </div>
      </div>
    </>
  )
}

function Results({ review }: { review: LinkedInReview }) {
  const band = scoreBand(review.score)
  return (
    <>
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing value={review.score} label="LinkedIn health" size={112} showLabel={false} />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-title">LinkedIn health</h2>
              <Badge tone={band.tone} dot>
                {band.label}
              </Badge>
            </div>
            <dl className="grid grid-cols-3 gap-4">
              <Count label="Headlines" value={review.headline_suggestions.length} />
              <Count label="Keywords" value={review.keyword_suggestions.length} />
              <Count label="Tips" value={review.tips.length} />
            </dl>
          </div>
        </div>
      </Card>

      <Card title="Headline suggestions" description="Pick one and paste it into your profile." padding={false}>
        {review.headline_suggestions.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {review.headline_suggestions.map((h, i) => (
              <li key={i} className="flex items-center gap-3 py-2 pr-3 pl-5 text-sm text-ink">
                <span className="t-num w-4 shrink-0 text-xs text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">{h}</span>
                <CopyButton text={h} label="Copy headline" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 pb-5 text-[13px] text-muted">No suggestions.</p>
        )}
      </Card>

      <Card title="About rewrite" description="A stronger About section, ready to copy.">
        <ImprovedText text={review.about_rewrite} label="Copy About section" className="text-sm leading-6" />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Keywords to add" description="Terms recruiters search for.">
          {review.keyword_suggestions.length ? (
            <div className="flex flex-wrap gap-1.5">
              {review.keyword_suggestions.map((k) => (
                <Badge key={k} tone="brand">
                  {k}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">None noted.</p>
          )}
        </Card>
        <Card title="Tips">
          <BulletList items={review.tips} />
        </Card>
      </div>
    </>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="t-overline">{label}</dt>
      <dd className="t-num mt-0.5 text-lg font-semibold text-ink">{value}</dd>
    </div>
  )
}
