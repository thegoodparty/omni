import type {
  ConstituentFeedbackChannel,
  ConstituentFeedbackIssue,
} from '@goodparty_org/contracts'
import { Badge, EmptyState, Overline } from '@styleguide'
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
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
      {memos.map((memo) => (
        <li key={memo.id} className="flex flex-col gap-2 px-4 py-3">
          {/* Who, where and when on one line, so the note under it is the
              first thing read; the review state is a badge, not a tail on
              that line. */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {CHANNEL_LABELS[memo.channel]}
              {' · '}
              {formatDate(memo.occurredAt)}
              {' · '}
              {copy.summaryBy(memo.actorName)}
            </p>
            {memo.pending && (
              <Badge variant="outline">{copy.notYetReviewed}</Badge>
            )}
          </div>
          {/* The note as written, set apart the way a field shows its
              value, so it reads as the source and the labelled issues
              under it as what was taken from it. */}
          {memo.transcript !== null && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
              {memo.transcript}
            </p>
          )}
          {memo.issues.length > 0 && (
            <ul aria-label={copy.issues} className="flex flex-col gap-3">
              {memo.issues.map((issue) => (
                // `flex flex-col` because globals.css makes every `li` under
                // a data-slot ancestor a row flex box. Labelled with the
                // confirm form's own words, so the person who confirmed it
                // recognises the fields.
                <li key={issue.position} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <Overline emphasis={false}>{copy.issueHeading}</Overline>
                      <span className="text-sm font-medium text-foreground">
                        {issue.issueLabel}
                      </span>
                    </div>
                    {issue.stance !== null && (
                      <div className="flex flex-col items-end gap-1">
                        <Overline emphasis={false}>
                          {copy.stanceHeading}
                        </Overline>
                        <Badge variant="soft">
                          {stanceLabels[issue.stance]}
                        </Badge>
                      </div>
                    )}
                  </div>
                  {issue.desiredOutcome !== null && (
                    <div className="flex flex-col gap-1">
                      <Overline emphasis={false}>
                        {copy.outcomeHeading}
                      </Overline>
                      <p className="text-sm text-foreground">
                        {issue.desiredOutcome}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

export default MemoList
