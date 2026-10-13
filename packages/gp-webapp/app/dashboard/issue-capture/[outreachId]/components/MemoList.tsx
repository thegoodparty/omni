import type {
  ConstituentFeedbackChannel,
  ConstituentFeedbackIssue,
} from '@goodparty_org/contracts'
import Link from 'next/link'
import { Badge, Button, EmptyState } from '@styleguide'
import { CHANNEL_LABELS, STANCE_LABELS, whatWeHeardCopy } from '../../copy'
import EditMemoMenu from './EditMemoMenu'

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
// The confirm form's field label, so the fields read the same on the note
// as where they were confirmed.
const FIELD_LABEL_CLASSNAME =
  'text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground'

// A note's first words, or who took it and when, so a list of Review
// buttons is not one name said several times.
const NAME_WORDS = 6
const noteName = (
  memo: MemoListItem,
  copy: ReturnType<typeof whatWeHeardCopy>,
): string => {
  const words = memo.transcript?.split(/\s+/).filter(Boolean) ?? []
  if (words.length === 0) return copy.noteFrom(memo.actorName, memo.occurredAt)
  const lead = words.slice(0, NAME_WORDS).join(' ')
  return words.length > NAME_WORDS ? `${lead}…` : lead
}

const MemoList = ({
  memos,
  outreachId,
  isServe,
}: {
  memos: MemoListItem[]
  outreachId: number
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {CHANNEL_LABELS[memo.channel]}
              {' · '}
              {formatDate(memo.occurredAt)}
              {' · '}
              {copy.summaryBy(memo.actorName)}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              {/* Waiting for review is something to act on, so it is the way
                  to the review list, landing on this note, rather than a
                  label. The review list also handles a note still
                  transcribing or one that failed, which the report cannot
                  tell apart from one with no issues. */}
              {memo.pending && (
                <Button asChild variant="link" size="small">
                  <Link
                    href={`/dashboard/issue-capture/${outreachId}/review#note-${memo.id}`}
                    aria-label={copy.reviewNote(noteName(memo, copy))}
                  >
                    {copy.review}
                  </Link>
                </Button>
              )}
              <EditMemoMenu memo={memo} isServe={isServe} />
            </div>
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
                // `grid` because globals.css makes every `li` under a
                // data-slot ancestor a row flex box. Two quiet labels in one
                // column and the values beside them, the stance as a badge on
                // the issue it belongs to, so a note's issue and what the
                // person wants read as two fields rather than one sentence
                // said twice. The labels are the confirm form's own style.
                <li
                  key={issue.position}
                  className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1"
                >
                  <span className={FIELD_LABEL_CLASSNAME}>
                    {copy.issueHeading}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {issue.issueLabel}
                    </span>
                    {/* No stance reads as Unclear, as the report counts it:
                        the same state should not look like two. */}
                    <Badge variant="soft">
                      {stanceLabels[issue.stance ?? 'unclear']}
                    </Badge>
                  </span>
                  {issue.desiredOutcome !== null && (
                    <>
                      <span className={FIELD_LABEL_CLASSNAME}>
                        {copy.wantsHeading}
                      </span>
                      <span className="text-sm text-foreground">
                        {issue.desiredOutcome}
                      </span>
                    </>
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
