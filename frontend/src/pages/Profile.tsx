import { Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ResumeDropzone } from '../components/Resume'
import { Button, Card, ErrorMessage, Field, inputCls, KeyNotice, PageIntro } from '../components/ui'
import { api, useAction, type Profile } from '../lib/api'
import { pushHistory, useApiKey, useProfile, useResume } from '../lib/store'

const EMPTY: Profile = { name: '', headline: '', current_role: '', years_experience: 0, location: '', skills: [], summary: '' }

export default function ProfilePage() {
  const [resume, setResume] = useResume()
  const [profile, setProfile] = useProfile()
  const key = useApiKey()
  const [draft, setDraft] = useState<Profile>(profile ?? EMPTY)
  const [skillsText, setSkillsText] = useState((profile?.skills ?? []).join(', '))
  const yearsOf = (p: Profile | null) => (p ? String(p.years_experience) : '')
  const [yearsText, setYearsText] = useState(yearsOf(profile))
  const [saved, setSaved] = useState(false)
  const extract = useAction(api.profile)

  useEffect(() => {
    setDraft(profile ?? EMPTY)
    setSkillsText((profile?.skills ?? []).join(', '))
    setYearsText(yearsOf(profile))
  }, [profile])

  function commit(next: Profile) {
    setProfile(next)
    pushHistory('skills', next.skills.length)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function runExtract() {
    if (!resume?.text) return
    const result = await extract.run(resume.text)
    if (result) commit(result)
  }

  function save() {
    const skills = [...new Set(skillsText.split(',').map((s) => s.trim()).filter(Boolean))]
    commit({ ...draft, skills, years_experience: Number(yearsText) || 0 })
  }

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <>
      <PageIntro>
        Upload your resume once. Every tool reuses it, and it never leaves this browser except when you run an analysis.
      </PageIntro>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Resume">
          <div className="space-y-4">
            <ResumeDropzone />
            <Field label="Resume text" hint="You can edit or paste the text directly.">
              <textarea
                className={`${inputCls} h-64`}
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
            <KeyNotice />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={runExtract} loading={extract.loading} disabled={!resume?.text || !key}>
                <Sparkles className="size-4" aria-hidden="true" />
                Extract profile
              </Button>
              {resume?.text && (
                <Button variant="secondary" onClick={() => setResume(null)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove resume
                </Button>
              )}
              {resume && (
                <span className="text-xs tabular-nums text-slate-500">
                  {resume.pages > 0 && `${resume.pages} pages, `}
                  {resume.characters.toLocaleString()} characters
                </span>
              )}
            </div>
            <ErrorMessage message={extract.error} />
          </div>
        </Card>

        <Card title="Profile">
          <form
            className="space-y-4"
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
                  className={inputCls}
                  value={yearsText}
                  placeholder="e.g. 4"
                  onChange={(e) => setYearsText(e.target.value)}
                />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={draft.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
            </div>
            <Field label="Headline">
              <input className={inputCls} value={draft.headline} onChange={(e) => set('headline', e.target.value)} />
            </Field>
            <Field label="Skills" hint="Separate skills with commas.">
              <textarea className={`${inputCls} h-20`} value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
            </Field>
            <Field label="Summary">
              <textarea className={`${inputCls} h-28`} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit">Save profile</Button>
              {saved && (
                <span role="status" className="text-sm text-emerald-700">
                  Saved
                </span>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  )
}
