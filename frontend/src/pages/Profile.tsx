import { MapPin, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ResumeDropzone, ResumeFileRow } from '../components/Resume'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  IconButton,
  inputCls,
  KeyNotice,
  PageHeader,
  textareaCls,
  toast,
} from '../components/ui'
import { api, useAction, type Profile } from '../lib/api'
import { pushHistory, useApiKey, useProfile, useResume } from '../lib/store'

const EMPTY: Profile = { name: '', headline: '', current_role: '', years_experience: 0, location: '', skills: [], summary: '' }

const yearsOf = (p: Profile | null) => (p ? String(p.years_experience) : '')
const uniq = (items: string[]) => [...new Set(items.map((s) => s.trim()).filter(Boolean))]

function ProfileSummary({ profile }: { profile: Profile | null }) {
  const p = profile ?? EMPTY
  const hasAny = !!(p.name || p.headline || p.current_role || p.location)
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={p.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base leading-6 font-semibold text-ink">{p.name || 'Your name'}</p>
          <p className="truncate text-[13px] text-muted">
            {p.headline || p.current_role || (hasAny ? 'No headline yet' : 'Upload your resume and extract your profile, or fill in the form below.')}
          </p>
        </div>
        {hasAny && (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            {p.location && (
              <div className="flex items-center gap-1.5 text-muted">
                <dt className="sr-only">Location</dt>
                <MapPin className="size-4" strokeWidth={1.75} aria-hidden="true" />
                <dd>{p.location}</dd>
              </div>
            )}
            <div>
              <dt className="t-overline">Experience</dt>
              <dd className="t-num text-ink">
                {p.years_experience} {p.years_experience === 1 ? 'year' : 'years'}
              </dd>
            </div>
            <div>
              <dt className="t-overline">Skills</dt>
              <dd className="t-num text-ink">{p.skills.length}</dd>
            </div>
          </dl>
        )}
      </div>
    </Card>
  )
}

export default function ProfilePage() {
  const [resume, setResume] = useResume()
  const [profile, setProfile] = useProfile()
  const key = useApiKey()
  const [draft, setDraft] = useState<Profile>(profile ?? EMPTY)
  const [yearsText, setYearsText] = useState(yearsOf(profile))
  const [skillInput, setSkillInput] = useState('')
  const extract = useAction(api.profile)

  useEffect(() => {
    setDraft(profile ?? EMPTY)
    setYearsText(yearsOf(profile))
  }, [profile])

  function commit(next: Profile, message: string) {
    setProfile(next)
    pushHistory('skills', next.skills.length)
    toast(message)
  }

  async function runExtract() {
    if (!resume?.text) return
    const result = await extract.run(resume.text)
    if (result) commit(result, 'Profile extracted from resume')
  }

  function addSkills(text: string) {
    const added = text.split(',')
    setDraft((d) => ({ ...d, skills: uniq([...d.skills, ...added]) }))
    setSkillInput('')
  }

  function save() {
    // Include a skill that was typed but not yet added.
    const skills = uniq([...draft.skills, ...skillInput.split(',')])
    setSkillInput('')
    commit({ ...draft, skills, years_experience: Number(yearsText) || 0 }, 'Profile saved')
  }

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <>
      <PageHeader
        title="Profile"
        description="Upload your resume once. Every tool reuses it, and it only leaves this browser when you run an analysis."
        actions={
          <Button variant="brand" icon={Sparkles} onClick={runExtract} loading={extract.loading} disabled={!resume?.text || !key}>
            Extract profile
          </Button>
        }
      />

      <ProfileSummary profile={profile} />
      <KeyNotice />
      <ErrorMessage message={extract.error} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div>
          <Card
            title="Resume"
            description="PDF text is used by every tool."
            action={resume?.text && <IconButton icon={Trash2} label="Remove resume" size="sm" onClick={() => setResume(null)} />}
          >
            <div className="space-y-4">
              <ResumeFileRow />
              <ResumeDropzone compact={!!resume?.text} />
              <Field label="Resume text" hint="You can edit or paste the text directly.">
                <textarea
                  className={`${textareaCls} h-64`}
                  value={resume?.text ?? ''}
                  onChange={(e) =>
                    setResume({
                      text: e.target.value,
                      pages: resume?.pages ?? 0,
                      characters: e.target.value.length,
                      fileName: resume?.fileName || 'Pasted resume',
                    })
                  }
                  placeholder="Your resume text will appear here."
                />
              </Field>
            </div>
          </Card>
        </div>

        <Card title="Details" description="Used to personalise matches, reviews and cover letters." divider>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input className={inputCls} value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Current role">
                <input className={inputCls} value={draft.current_role} onChange={(e) => set('current_role', e.target.value)} />
              </Field>
              <Field label="Years of experience">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={`${inputCls} t-num`}
                  value={yearsText}
                  placeholder="e.g. 4"
                  onChange={(e) => setYearsText(e.target.value)}
                />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={draft.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Headline">
                  <input className={inputCls} value={draft.headline} onChange={(e) => set('headline', e.target.value)} />
                </Field>
              </div>
            </div>

            <div>
              <span className="t-label mb-1.5 block" id="skills-label">
                Skills <span className="t-num text-faint">{draft.skills.length}</span>
              </span>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  aria-labelledby="skills-label"
                  value={skillInput}
                  placeholder="Add a skill and press Enter"
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addSkills(skillInput)
                    }
                  }}
                />
                <Button variant="secondary" icon={Plus} onClick={() => addSkills(skillInput)} disabled={!skillInput.trim()}>
                  Add
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {draft.skills.length ? (
                  draft.skills.map((s) => (
                    <Badge key={s} onRemove={() => set('skills', draft.skills.filter((x) => x !== s))} removeLabel="Remove skill">
                      {s}
                    </Badge>
                  ))
                ) : (
                  <p className="text-[13px] text-muted">No skills added yet.</p>
                )}
              </div>
            </div>

            <Field label="Summary">
              <textarea className={`${textareaCls} h-28`} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
            </Field>

            <div className="flex justify-end border-t border-line pt-4">
              <Button type="submit">Save profile</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  )
}
