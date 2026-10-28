import {
  EMAIL_LAYOUTS,
  EMAIL_SEND_WINDOW_DAYS,
  type EmailDraftSave,
  type EmailLayoutKey,
  type EmailRecipientUploadResponse,
  type EmailThemeKey,
} from '@goodparty_org/contracts'

// The warming ladder from the TDD, indexed by the sender's `warmingStep`.
// gp-api freezes the real cap when the send is confirmed; this is the number
// the audience step can promise until then.
const WARMING_CAPS = [1_000, 5_000, 25_000, 100_000, 250_000] as const

export const warmingCap = (warmingStep: number): number =>
  WARMING_CAPS[Math.min(warmingStep, WARMING_CAPS.length - 1)] ??
  WARMING_CAPS[0]

export const nextWarmingCap = (warmingStep: number): number | null =>
  WARMING_CAPS[warmingStep + 1] ?? null

export const formatCount = (count: number): string =>
  count.toLocaleString('en-US')

export const uploadSummary = (result: EmailRecipientUploadResponse): string =>
  `${formatCount(result.ready)} ready, ${formatCount(
    result.invalid + result.unsubscribed,
  )} skipped, ${formatCount(result.duplicate)} duplicates`

export interface EmailComposeState {
  layout: EmailLayoutKey
  theme: EmailThemeKey
  subject: string
  headline: string
  body: string
  buttonLabel: string
  buttonUrl: string
  imageUrl: string
}

export const initialCompose: EmailComposeState = {
  layout: 'newsletter',
  theme: EMAIL_LAYOUTS.newsletter.defaultTheme,
  subject: '',
  headline: '',
  body: '',
  buttonLabel: '',
  buttonUrl: '',
  imageUrl: '',
}

const isHttps = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export interface ComposeIssues {
  subject?: string
  body?: string
  button?: string
}

export const composeIssues = (state: EmailComposeState): ComposeIssues => {
  const issues: ComposeIssues = {}
  if (!state.subject.trim()) issues.subject = 'Add a subject line.'
  if (!state.body.trim()) issues.body = 'Write your message.'
  const hasLabel = state.buttonLabel.trim() !== ''
  const hasUrl = state.buttonUrl.trim() !== ''
  if (EMAIL_LAYOUTS[state.layout].requiresButton && !(hasLabel && hasUrl)) {
    issues.button = 'This layout needs a button label and a link.'
  } else if (hasLabel !== hasUrl) {
    issues.button = 'A button needs both a label and a link.'
  } else if (hasUrl && !isHttps(state.buttonUrl.trim())) {
    issues.button = 'The link must start with https://.'
  }
  return issues
}

export const toDraftSave = (
  goal: string,
  state: EmailComposeState,
  id: number | null,
  date: string | undefined,
): EmailDraftSave => {
  const headline = state.headline.trim()
  const hasButton =
    state.buttonLabel.trim() !== '' && state.buttonUrl.trim() !== ''
  return {
    ...(id !== null ? { id } : {}),
    goal,
    layout: state.layout,
    theme: state.theme,
    subject: state.subject,
    ...(headline ? { headline } : {}),
    body: state.body,
    ...(state.imageUrl ? { imageUrl: state.imageUrl } : {}),
    ...(hasButton
      ? {
          buttonLabel: state.buttonLabel.trim(),
          buttonUrl: state.buttonUrl.trim(),
        }
      : {}),
    ...(date ? { date } : {}),
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const toDateInput = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export type ScheduleCheck =
  | { ok: true; iso: string | undefined }
  | { ok: false; message: string }

// `sendNow` leaves the date off: the send goes out once it is paid.
export const checkSchedule = (
  sendNow: boolean,
  day: string,
  time: string,
  now: Date = new Date(),
): ScheduleCheck => {
  if (sendNow) return { ok: true, iso: undefined }
  if (!day || !time) return { ok: false, message: 'Pick a day and a time.' }
  const when = new Date(`${day}T${time}`)
  if (Number.isNaN(when.getTime())) {
    return { ok: false, message: 'Pick a day and a time.' }
  }
  if (when.getTime() < now.getTime()) {
    return { ok: false, message: 'Pick a time that has not passed.' }
  }
  const latest = new Date(now)
  latest.setDate(latest.getDate() + EMAIL_SEND_WINDOW_DAYS)
  if (when.getTime() > latest.getTime()) {
    return {
      ok: false,
      message: `Pick a day within the next ${EMAIL_SEND_WINDOW_DAYS} days.`,
    }
  }
  return { ok: true, iso: when.toISOString() }
}

export const formatDollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
