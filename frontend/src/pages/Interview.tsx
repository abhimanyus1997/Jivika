import { MessageSquareText, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import { ResumeSource } from '../components/Resume'
import { BulletList, Button, Card, Chip, CopyButton, EmptyState, ErrorMessage, Field, inputCls, KeyNotice, PageIntro, ActionHint, scoreBand } from '../components/ui'
import { api, useAction, type InterviewQuestion } from '../lib/api'
import { useApiKey, useInterview, useJobDescription, useResume } from '../lib/store'

const TYPE_TONE = { behavioral: 'indigo', technical: 'emerald', situational: 'amber' } as const

function QuestionCard({ index, q, jd }: { index: number; q: InterviewQuestion; jd: string }) {
  const [session, setSession] = useInterview()
  const key = useApiKey()
  const action = useAction(api.feedback)
  const answer = session.answers[index] ?? ''
  const fb = session.feedback[index]

  async function submit() {
    const r = await action.run(q.question, answer.trim(), jd)
    if (r) setSession((s) => ({ ...s, feedback: { ...s.feedback, [index]: r } }))
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-slate-500">Q{index + 1}</span>
        <Chip tone={TYPE_TONE[q.type] ?? 'slate'}>{q.type[0].toUpperCase() + q.type.slice(1)}</Chip>
      </div>
      <h3 className="mt-2 font-semibold text-slate-900">{q.question}</h3>
      <p className="mt-1 text-sm text-slate-600">
        <span className="font-medium text-slate-700">What they look for: </span>
        {q.what_they_look_for}
      </p>
      <div className="mt-4 space-y-3">
        <Field label="Your answer">
          <textarea
            className={`${inputCls} h-28`}
            value={answer}
            onChange={(e) => setSession((s) => ({ ...s, answers: { ...s.answers, [index]: e.target.value } }))}
            placeholder="Write your answer in at least a sentence."
          />
        </Field>
        <ErrorMessage message={action.error} />
        <Button variant="secondary" onClick={submit} loading={action.loading} disabled={!key || answer.trim().length < 10}>
          <MessageSquareText className="size-4" aria-hidden="true" />
          Get feedback
        </Button>
        <ActionHint show={key && answer.trim() && answer.trim().length < 10}>Write at least a sentence to get feedback.</ActionHint>
      </div>
      {fb && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{fb.score}</span>
            <span className="text-sm text-slate-500">/100</span>
            <span className={`text-sm font-medium ${scoreBand(fb.score).text}`}>{scoreBand(fb.score).label}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700">Strengths</h4>
              <BulletList items={fb.strengths} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-slate-700">Improvements</h4>
              <BulletList items={fb.improvements} />
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-medium text-emerald-900">Improved answer</h4>
              <CopyButton text={fb.improved_answer} label="Copy improved answer" />
            </div>
            <p className="whitespace-pre-line text-sm text-slate-800">{fb.improved_answer}</p>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Interview() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [session, setSession] = useInterview()
  const [count, setCount] = useState(8)
  const key = useApiKey()
  const action = useAction(api.questions)

  async function generate() {
    if (!resume?.text) return
    const r = await action.run(resume.text, jd, count)
    if (r) setSession({ questions: r.questions, answers: {}, feedback: {} })
  }

  return (
    <>
      <PageIntro>Practice with questions tailored to the role, then get feedback on each answer.</PageIntro>
      <Card>
        <div className="space-y-4">
          <ResumeSource />
          <Field label="Job description">
            <textarea className={`${inputCls} h-40`} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the job description." />
          </Field>
          <Field label="Number of questions">
            <input
              type="number"
              min={1}
              max={15}
              className={`${inputCls} max-w-32`}
              value={count}
              onChange={(e) => setCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))}
            />
          </Field>
          <KeyNotice />
          <ErrorMessage message={action.error} />
          <Button onClick={generate} loading={action.loading} disabled={!key || !resume?.text || jd.trim().length < 30}>
            <MessagesSquare className="size-4" aria-hidden="true" />
            Generate questions
          </Button>
          <ActionHint show={key && resume?.text && jd.trim().length < 30}>Paste at least a few lines of the job description to continue.</ActionHint>
        </div>
      </Card>

      {session.questions.length ? (
        session.questions.map((q, i) => <QuestionCard key={`${i}-${q.question}`} index={i} q={q} jd={jd} />)
      ) : (
        <Card>
          <EmptyState icon={<MessagesSquare className="size-8" />} title="No questions yet" text="Generated interview questions will appear here." />
        </Card>
      )}
    </>
  )
}
