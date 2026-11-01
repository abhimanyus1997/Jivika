import { request, type EmailTone } from './api'
import { useStored } from './store'

export type InboxKind = 'interview_invite' | 'question' | 'rejection' | 'offer' | 'acknowledgement' | 'assessment' | 'other'

export const KIND_INFO: Record<InboxKind, { label: string; tone: 'neutral' | 'brand' | 'accent' | 'warning' | 'danger' | 'info' }> = {
  interview_invite: { label: 'Interview invite', tone: 'accent' },
  question: { label: 'Question', tone: 'info' },
  rejection: { label: 'Rejection', tone: 'danger' },
  offer: { label: 'Offer', tone: 'brand' },
  acknowledgement: { label: 'Acknowledgement', tone: 'neutral' },
  assessment: { label: 'Assessment', tone: 'warning' },
  other: { label: 'Other', tone: 'neutral' },
}

export interface Classification {
  kind: InboxKind
  summary: string
  sender_name: string
  sender_company: string
  application_id: string
  suggested_status: string
  proposed_times: string[]
  reply_needed: boolean
}

export interface InboxItem extends Classification {
  id: string
  added: string // ISO
  email_text: string
  answered?: boolean
  status_applied?: boolean
  /** Proposed times already added as interviews. */
  added_times?: string[]
  reply?: { subject: string; body: string; tone: EmailTone }
  availability?: string
}

export const useInbox = () => useStored<InboxItem[]>('inbox', [])

export const needsAnswer = (i: InboxItem) => i.reply_needed && !i.answered
export const needsAnswerCount = (items: InboxItem[]) => items.filter(needsAnswer).length

/** First email address in the text that is not the user's own. */
export function senderAddress(text: string, own = ''): string {
  const all = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []
  return all.find((a) => a.toLowerCase() !== own.toLowerCase()) ?? ''
}

/* ---------- API (/api/inbox/*) ---------- */

export const inboxApi = {
  classify: (email_text: string, applications: { id: string; company: string; role: string; status: string }[]) =>
    request<Classification>('/inbox/classify', { ai: true, body: { email_text: email_text.slice(0, 12000), applications: applications.slice(0, 200) } }),
  reply: (body: {
    email_text: string
    kind: InboxKind
    basics: { name: string; email: string; phone: string }
    application: { company: string; role: string }
    profile_summary?: string
    availability?: string
    tone: EmailTone
  }) => request<{ subject: string; body: string }>('/inbox/reply', { ai: true, body }),
}
