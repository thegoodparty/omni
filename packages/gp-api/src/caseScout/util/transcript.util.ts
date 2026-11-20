import { formatInTimeZone } from 'date-fns-tz'
import { ChatMessageRole } from '@/generated/prisma'
import type { Session } from './sessions.util'

const UTC = 'UTC'

// Python's datetime.isoformat() for a UTC timestamp, so the transcript the
// model reads is shaped exactly like the one the quality bench graded.
const pythonIsoformat = (date: Date): string =>
  formatInTimeZone(date, UTC, 'SSS') === '000'
    ? formatInTimeZone(date, UTC, "yyyy-MM-dd'T'HH:mm:ss'+00:00'")
    : formatInTimeZone(date, UTC, "yyyy-MM-dd'T'HH:mm:ss.SSS'000+00:00'")

// The block the scoring prompt reads as "a session transcript". Tool calls sit
// under the message that made it; their results are never stored. A missing
// tool input renders as Python's None did.
export const renderSessionTranscript = (session: Session): string => {
  const typedUserTurns = session.messages.filter(
    (message) =>
      message.role === ChatMessageRole.user && message.content.trim() !== '',
  ).length
  const lines = [
    `# session ${session.sessionId}`,
    `scope: ${session.scope}`,
    `typed user turns: ${typedUserTurns}`,
    `started: ${pythonIsoformat(session.startedAt)}`,
    '',
  ]
  session.messages.forEach((message, index) => {
    const blank = message.content.trim() === ''
    lines.push(
      `**${message.role}** (#${index + 1}, ${message.messageId}, ` +
        `${pythonIsoformat(message.createdAt)})${blank ? ' [empty]' : ''}`,
    )
    if (!blank) lines.push(message.content)
    for (const call of message.toolCalls) {
      lines.push(`tool: ${call.tool ?? 'None'} input: ${call.input ?? 'None'}`)
    }
    lines.push('---')
  })
  return lines.join('\n')
}

// Everything the drafter reads that a draft could copy: user and assistant
// turns, and each tool call's input as the transcript shows it.
export const sessionSourceTexts = (session: Session): string[] =>
  session.messages.flatMap((message) => [
    ...((message.role === ChatMessageRole.user ||
      message.role === ChatMessageRole.assistant) &&
    message.content.trim() !== ''
      ? [message.content]
      : []),
    ...message.toolCalls.flatMap((call) =>
      call.input && call.input.trim() !== '' ? [call.input] : [],
    ),
  ])

export const sessionDenylist = (session: Session): string[] => [
  ...new Set(session.messages.flatMap((message) => message.denylist)),
]
