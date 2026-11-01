import { FileText, LayoutList, MapPin, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ProfileEditor, StrengthMeter } from '../components/ProfileEditor'
import { ResumeDropzone, ResumeFileRow } from '../components/Resume'
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  IconButton,
  inputCls,
  KeyNotice,
  Modal,
  PageHeader,
  textareaCls,
  toast,
} from '../components/ui'
import { api, profileExperience, useAction, useAiReady, type Profile } from '../lib/api'
import {
  emptyStructured,
  normalizeStructured,
  pushHistory,
  syncProfileFromStructured,
  useProfile,
  useResume,
  useResumeSettings,
  useStructuredProfile,
} from '../lib/store'

const EMPTY: Profile = {
  name: '',
  headline: '',
  current_role: '',
  experience_years: 0,
  experience_months: 0,
  years_experience: 0,
  location: '',
  skills: [],
  summary: '',
  phone: '',
  email: '',
  linkedin: '',
}

/** Form text for years / months: blank when never set. */
const experienceText = (p: Profile | null) => {
  const set = !!p && (p.experience_set || p.experience_years > 0 || p.experience_months > 0)
  return { years: set ? String(p.experience_years) : '', months: set ? String(p.experience_months) : '' }
}

/** Validation message for a whole-number field, or '' when valid (blank is allowed). */
function rangeError(text: string, max: number, unit: string) {
  if (!text.trim()) return ''
  const n = Number(text)
  return Number.isInteger(n) && n >= 0 && n <= max ? '' : `${unit} must be a whole number from 0 to ${max}.`
}
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
              <dd className="t-num text-ink">{profileExperience(p) || 'Not set'}</dd>
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

/** Structured profile: built from the resume by the model, then edited here. Feeds the Resume page. */
function StructuredSection() {
  const [resume] = useResume()
  const [structured, setStructured] = useStructuredProfile()
  const [settings, setSettings] = useResumeSettings()
  const [confirm, setConfirm] = useState<'rebuild' | 'remove' | null>(null)
  const key = useAiReady()
  const build = useAction(api.structureProfile)

  async function runBuild() {
    setConfirm(null)
    if (!resume?.text) return
    const r = await build.run(resume.text)
    if (!r) return
    const sp = normalizeStructured(r)
    setStructured(sp)
    syncProfileFromStructured(sp)
    toast('Structured profile built from resume')
  }

  return (
    <section aria-labelledby="structured-title" className="space-y-4">
      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="structured-title" className="text-base leading-6 font-semibold text-ink">
            Structured profile
          </h2>
          <p className="text-[13px] text-muted">Sections for your resume. Edits save in this browser as you type.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {structured && (
            <ButtonLink href="#resume" size="sm" icon={FileText}>
              View resume
            </ButtonLink>
          )}
          <Button
            size="sm"
            variant={structured ? 'secondary' : 'brand'}
            icon={Sparkles}
            loading={build.loading}
            disabled={!resume?.text || !key}
            onClick={() => (structured ? setConfirm('rebuild') : runBuild())}
          >
            {structured ? 'Rebuild from resume' : 'Build structured profile from resume'}
          </Button>
          {structured && (
            <IconButton icon={Trash2} size="sm" label="Remove structured profile" className="hover:bg-danger-bg hover:text-danger" onClick={() => setConfirm('remove')} />
          )}
        </div>
      </div>
      <ErrorMessage message={build.error} />

      {structured ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          {/* Name, headline and contact flow into the simple profile when a field loses focus. */}
          <div onBlur={() => syncProfileFromStructured(structured)}>
            <ProfileEditor
              value={structured}
              onChange={setStructured}
              order={settings.order}
              onOrderChange={(order) => setSettings({ ...settings, order })}
            />
          </div>
          <div className="lg:sticky lg:top-[76px]">
            <StrengthMeter profile={structured} />
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<LayoutList />}
            title="No structured profile yet"
            text={
              resume?.text
                ? 'Build one from your resume to edit experience, projects and education as separate entries, and render them as a resume.'
                : 'Upload your resume above to build one, or start from a blank profile.'
            }
            action={
              <Button variant="secondary" icon={Plus} onClick={() => setStructured(emptyStructured())}>
                Start from scratch
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'remove' ? 'Remove structured profile?' : 'Rebuild from resume?'}
        width="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === 'remove' ? (
              <Button
                variant="danger"
                icon={Trash2}
                onClick={() => {
                  setStructured(null)
                  setConfirm(null)
                  toast('Structured profile removed')
                }}
              >
                Remove
              </Button>
            ) : (
              <Button variant="brand" icon={Sparkles} onClick={runBuild}>
                Rebuild
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm text-ink">
          {confirm === 'remove'
            ? 'Your structured entries will be deleted from this browser. Tailored resumes you already made are kept.'
            : 'This replaces your structured entries, including edits, with a fresh read of your resume.'}
        </p>
      </Modal>
    </section>
  )
}

export default function ProfilePage() {
  const [resume, setResume] = useResume()
  const [profile, setProfile] = useProfile()
  const key = useAiReady()
  const [draft, setDraft] = useState<Profile>(profile ?? EMPTY)
  const [exp, setExp] = useState(() => experienceText(profile))
  const [skillInput, setSkillInput] = useState('')
  const extract = useAction(api.profile)

  useEffect(() => {
    setDraft(profile ?? EMPTY)
    setExp(experienceText(profile))
  }, [profile])

  function commit(next: Profile, message: string) {
    setProfile(next)
    pushHistory('skills', next.skills.length)
    toast(message)
  }

  async function runExtract() {
    if (!resume?.text) return
    const result = await extract.run(resume.text)
    if (result) commit({ ...result, experience_set: false }, 'Profile extracted from resume')
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
    const years = Number(exp.years) || 0
    const months = Number(exp.months) || 0
    commit(
      {
        ...draft,
        skills,
        experience_years: years,
        experience_months: months,
        years_experience: Math.round((years + months / 12) * 100) / 100,
        experience_set: !!(exp.years.trim() || exp.months.trim()),
      },
      'Profile saved',
    )
  }

  const yearsError = rangeError(exp.years, 60, 'Years')
  const monthsError = rangeError(exp.months, 11, 'Months')
  const expError = yearsError || monthsError

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
                      ...resume,
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
              <fieldset aria-describedby={expError ? 'experience-error' : undefined}>
                <legend className="t-label mb-1.5 block">Experience</legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="relative block">
                    <span className="sr-only">Years</span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={1}
                      inputMode="numeric"
                      className={`${inputCls} t-num pr-12`}
                      value={exp.years}
                      placeholder="0"
                      aria-invalid={!!yearsError || undefined}
                      onChange={(e) => setExp({ ...exp, years: e.target.value })}
                      onBlur={() => {
                        // '5.3' is common shorthand for 5 yrs 3 mos; same rule as the server (a 1-11 decimal
                        // without a leading zero is months, anything else a fraction of a year).
                        const m = /^(\d{1,2})\.(\d{1,2})$/.exec(exp.years.trim())
                        if (!m) return
                        const asMonths = m[2][0] !== '0' && +m[2] >= 1 && +m[2] <= 11
                        const total = +m[1] * 12 + (asMonths ? +m[2] : Math.round(+`0.${m[2]}` * 12))
                        setExp({ years: String(Math.floor(total / 12)), months: String(total % 12) })
                      }}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint" aria-hidden="true">
                      yrs
                    </span>
                  </label>
                  <label className="relative block">
                    <span className="sr-only">Months</span>
                    <input
                      type="number"
                      min={0}
                      max={11}
                      step={1}
                      inputMode="numeric"
                      className={`${inputCls} t-num pr-12`}
                      value={exp.months}
                      placeholder="0"
                      aria-invalid={!!monthsError || undefined}
                      onChange={(e) => setExp({ ...exp, months: e.target.value })}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint" aria-hidden="true">
                      mos
                    </span>
                  </label>
                </div>
                {expError ? (
                  <span id="experience-error" className="mt-1.5 block text-xs leading-4 text-danger">
                    {expError}
                  </span>
                ) : (
                  <span className="mt-1.5 block text-xs leading-4 text-faint">Years 0 to 60, months 0 to 11.</span>
                )}
              </fieldset>
              <Field label="Location">
                <input className={inputCls} value={draft.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="Email">
                <input inputMode="email" autoComplete="email" className={inputCls} value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input type="tel" autoComplete="tel" className={inputCls} value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="LinkedIn" hint="Profile URL, e.g. linkedin.com/in/your-name.">
                  <input inputMode="url" className={inputCls} value={draft.linkedin ?? ''} onChange={(e) => set('linkedin', e.target.value)} />
                </Field>
              </div>
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
              <Button type="submit" disabled={!!expError}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <StructuredSection />
    </>
  )
}
