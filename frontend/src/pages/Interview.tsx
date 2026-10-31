import { ChevronDown, MessageSquareText, MessagesSquare } from 'lucide-react'
import { useState } from 'react'
import { CodingSetup, ProblemList, ProblemView } from '../components/coding/Playground'
import { useCoding } from '../components/coding/store'
import { JobImport } from '../components/JobImport'
import { ResumeSource } from '../components/Resume'
import {
  ActionHint,
  Badge,
  BeforeAfter,
  BulletList,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  inputCls,
  KeyNotice,
  PageHeader,
  ScoreRing,
  scoreBand,
  Segmented,
  SkeletonCard,
  textareaCls,
  type BadgeTone,
} from '../components/ui'
import { api, useAction, useAiReady, type InterviewQuestion, type QuestionType } from '../lib/api'
import { useInterview, useJobDescription, useResume, useStored } from '../lib/store'

const TYPE_TONE: Record<QuestionType, BadgeTone> = { behavioral: 'info', technical: 'brand', situational: 'accent' }

function QuestionCard({ index, q, jd }: { index: number; q: InterviewQuestion; jd: string }) {
  const [session, setSession] = useInterview()
  const key = useAiReady()
  const action = useAction(api.feedback)
  const answer = session.answers[index] ?? ''
  const fb = session.feedback[index]
  const band = fb ? scoreBand(fb.score) : null

  async function submit() {
    const r = await action.run(q.question, answer.trim(), jd)
    if (r) setSession((s) => ({ ...s, feedback: { ...s.feedback, [index]: r } }))
  }

  // ponytail: native <details> is the accordion; keyboard and aria come free.
  return (
    <details open={index === 0} className="group rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl px-5 py-4 hover:bg-subtle/60 [&::-webkit-details-marker]:hidden">
        <span className="t-num mt-0.5 w-7 shrink-0 text-[13px] text-faint">Q{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={TYPE_TONE[q.type] ?? 'neutral'}>{q.type[0].toUpperCase() + q.type.slice(1)}</Badge>
            {band && fb ? (
              <Badge tone={band.tone} mono>
                {fb.score}/100
              </Badge>
            ) : answer.trim() ? (
              <Badge>Draft</Badge>
            ) : null}
          </div>
          <h3 className="t-title leading-6">{q.question}</h3>
        </div>
        <ChevronDown
          className="mt-1 size-4 shrink-0 text-faint transition-transform duration-150 group-open:rotate-180"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-4 border-t border-line px-5 py-5">
        <div>
          <div className="t-overline mb-1">What they look for</div>
          <p className="text-[13px] leading-5 text-muted">{q.what_they_look_for}</p>
        </div>
        <Field label="Your answer">
          <textarea
            className={`${textareaCls} min-h-32`}
            value={answer}
            onChange={(e) => setSession((s) => ({ ...s, answers: { ...s.answers, [index]: e.target.value } }))}
            placeholder="Write your answer in at least a sentence."
          />
        </Field>
        <ErrorMessage message={action.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            icon={MessageSquareText}
            onClick={submit}
            loading={action.loading}
            disabled={!key || answer.trim().length < 10}
          >
            {fb ? 'Get new feedback' : 'Get feedback'}
          </Button>
          <ActionHint show={key && answer.trim() && answer.trim().length < 10}>Write at least a sentence to get feedback.</ActionHint>
        </div>

        {action.loading && <SkeletonCard lines={3} label="Loading feedback" />}

        {fb && !action.loading && (
          <div className="space-y-5 rounded-lg border border-line bg-canvas p-4">
            <div className="flex items-center gap-4">
              <ScoreRing value={fb.score} label="Answer score" size={64} showLabel={false} />
              <div>
                <div className="t-title">Feedback</div>
                <p className={`text-[13px] font-medium ${band?.text}`}>{band?.label}</p>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="t-overline mb-2">Strengths</div>
                <BulletList items={fb.strengths} />
              </div>
              <div>
                <div className="t-overline mb-2">Improvements</div>
                <BulletList items={fb.improvements} />
              </div>
            </div>
            <BeforeAfter label="Improved answer" before={answer.trim() || 'No answer written.'} after={fb.improved_answer} />
          </div>
        )}
      </div>
    </details>
  )
}

export default function Interview() {
  const [resume] = useResume()
  const [jd, setJd] = useJobDescription()
  const [session, setSession] = useInterview()
  const [count, setCount] = useState(8)
  const key = useAiReady()
  const action = useAction(api.questions)
  const total = session.questions.length
  const reviewed = Object.keys(session.feedback).length
  const [tab, setTab] = useStored<'questions' | 'coding'>('interview.tab', 'questions')
  const [codingSession] = useCoding()
  const [openId, setOpenId] = useState('')
  const codingAction = useAction(api.codingProblems)
  const open = tab === 'coding' ? codingSession.problems.find((p) => p.id === openId) : undefined

  async function generate() {
    if (!resume?.text) return
    const r = await action.run(resume.text, jd, count)
    if (r) setSession({ questions: r.questions, answers: {}, feedback: {} })
  }

  const coding = tab === 'coding'

  return (
    <>
      <PageHeader
        title="Interview prep"
        description={
          coding
            ? 'Solve coding problems for the role. Your code runs in this browser, then you can get an AI review.'
            : 'Practice with questions tailored to the role, then get feedback on each answer.'
        }
      />
      <Segmented
        label="Practice type"
        className="mt-4 mb-5"
        options={[
          { value: 'questions', label: 'Questions' },
          { value: 'coding', label: 'Coding' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {open ? (
        <ProblemView key={open.id} problem={open} onBack={() => setOpenId('')} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
            <Card title="Setup" description={`${coding ? 'Problems' : 'Questions'} are based on your resume and the job description.`}>
              <div className="space-y-4">
                <ResumeSource />
                <JobImport onImport={(text) => setJd(text)} />
                <Field label="Job description">
                  <textarea
                    className={`${textareaCls} min-h-40`}
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste the job description."
                  />
                </Field>
                {coding ? (
                  <>
                    <KeyNotice />
                    <CodingSetup resume={resume?.text ?? ''} jd={jd} action={codingAction} />
                  </>
                ) : (
                  <>
                    <Field label="Number of questions" hint="Between 1 and 15.">
                      <input
                        type="number"
                        min={1}
                        max={15}
                        className={`${inputCls} t-num max-w-24`}
                        value={count}
                        onChange={(e) => setCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))}
                      />
                    </Field>
                    <KeyNotice />
                    <ErrorMessage message={action.error} />
                    <Button
                      variant="brand"
                      icon={MessagesSquare}
                      className="w-full"
                      onClick={generate}
                      loading={action.loading}
                      disabled={!key || !resume?.text || jd.trim().length < 30}
                    >
                      {total ? 'Generate new questions' : 'Generate questions'}
                    </Button>
                    <ActionHint show={key && resume?.text && jd.trim().length < 30}>
                      Paste at least a few lines of the job description to continue.
                    </ActionHint>
                  </>
                )}
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-3">
            {coding ? (
              <ProblemList loading={codingAction.loading} onOpen={setOpenId} />
            ) : action.loading ? (
              <>
                <SkeletonCard lines={2} label="Generating questions" />
                <SkeletonCard lines={2} label="Generating questions" />
                <SkeletonCard lines={2} label="Generating questions" />
              </>
            ) : total ? (
              <>
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="t-title">Questions</h2>
                  <span className="t-num text-[13px] text-muted">
                    {reviewed} of {total} reviewed
                  </span>
                </div>
                {session.questions.map((q, i) => (
                  <QuestionCard key={`${i}-${q.question}`} index={i} q={q} jd={jd} />
                ))}
              </>
            ) : (
              <Card>
                <EmptyState
                  icon={<MessagesSquare strokeWidth={1.75} />}
                  title="No questions yet"
                  text="Add your resume and the job description, then generate questions to start practising."
                />
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  )
}
