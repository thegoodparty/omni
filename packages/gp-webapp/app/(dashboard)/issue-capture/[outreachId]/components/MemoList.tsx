import type {
  ConstituentFeedbackChannel,
  ConstituentFeedbackIssue,
} from '@goodparty_org/contracts'
import { EmptyState } from '@styleguide'
import { CHANNEL_LABELS, STANCE_LABELS, whatWeHeardCopy } from '../../copy'

export interface MemoListItem {
  id: string
  transcript: string | null
  issues: ConstituentFeedbackIssue[]
  actorName: string | null
  channel: ConstituentFeedbackChannel
  occurredAt: Date
  // Listed, never counted: a note nobody who was there has confirmed.
  pending: boolean
}

const formatDate = (value: Date): string =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

// The notes themselves, on the report while there are no themes to show and
// under them once there are, and as a theme's members on its own page.
const MemoList = ({
  memos,
  isServe,
}: {
  memos: MemoListItem[]
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const stanceLabels = STANCE_LABELS[isServe ? 'serve' : 'win']

  if (memos.length === 0) return <EmptyState message={copy.noNotes} />

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {memos.map((memo) => (
        <li key={memo.id} className="flex flex-col gap-1 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.summaryBy(memo.actorName)}
          </p>
          {memo.transcript !== null && (
            <p className="text-sm italic text-foreground">{memo.transcript}</p>
          )}
          {memo.issues.length > 0 && (
            <ul aria-label={copy.issues} className="flex flex-col gap-0.5">
              {memo.issues.map((issue) => (
                <li key={issue.position} className="text-sm text-foreground">
                  <span className="font-medium">{issue.issueLabel}</span>
                  {issue.stance !== null && ` · ${stanceLabels[issue.stance]}`}
                  {issue.desiredOutcome !== null &&
                    ` · ${copy.wants}: ${issue.desiredOutcome}`}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {CHANNEL_LABELS[memo.channel]}
            {' · '}
            {formatDate(memo.occurredAt)}
            {memo.pending && ` · ${copy.notYetReviewed}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

export default MemoList
