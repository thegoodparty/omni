import type {
  ConstituentFeedbackIssue,
  FeedbackReportChannel,
} from '@goodparty_org/contracts'
import { Badge, Card, EmptyState, Overline } from '@styleguide'
import { CHANNEL_LABELS, STANCE_LABELS, whatWeHeardCopy } from '../../copy'

export interface MemoListItem {
  id: string
  transcript: string | null
  issues: ConstituentFeedbackIssue[]
  actorName: string | null
  channel: FeedbackReportChannel
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
// under them once there are, and as a theme's members on its own page. On a
// text send, the replies constituents wrote.
const MemoList = ({
  memos,
  channel,
  isServe,
}: {
  memos: MemoListItem[]
  // The effort's own channel, for the empty state: a text send with nothing
  // yet is waiting on replies, not notes.
  channel: FeedbackReportChannel
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const stanceLabels = STANCE_LABELS[isServe ? 'serve' : 'win']

  if (memos.length === 0) {
    return <EmptyState message={copy.noNotes(channel)} />
  }

  // A text send's replies keep the list they shipped with: they are the
  // person's own words, with their own rules, and are not redesigned here.
  if (channel === 'text') {
    return (
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {memos.map((memo) => (
          <li key={memo.id} className="flex flex-col gap-1 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              {copy.theirReply}
            </p>
            {memo.transcript !== null && (
              <p className="text-sm text-foreground">{memo.transcript}</p>
            )}
            {memo.issues.length > 0 && (
              <ul aria-label={copy.issues} className="flex flex-col gap-0.5">
                {memo.issues.map((issue) => (
                  // `block`: globals.css makes every li under a data-slot a
                  // flex row, which drops the space before each " · ".
                  <li
                    key={issue.position}
                    className="block text-sm text-foreground"
                  >
                    <span className="font-medium">{issue.issueLabel}</span>
                    {issue.stance !== null &&
                      ` · ${stanceLabels[issue.stance]}`}
                    {issue.desiredOutcome !== null &&
                      ` · ${copy.wantsHeading}: ${issue.desiredOutcome}`}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {CHANNEL_LABELS[memo.channel]}
              {' · '}
              {formatDate(memo.occurredAt)}
            </p>
          </li>
        ))}
      </ul>
    )
  }

  return (
    // A card per note, the theme cards' own frame and padding, so each
    // conversation reads as its own record rather than a row of one long
    // list. `block` because globals.css makes every `li` under a data-slot
    // ancestor a row flex box.
    <ul className="flex flex-col gap-3">
      {memos.map((memo) => (
        <li key={memo.id} className="block">
          <Card className="gap-3 p-4 md:p-6">
            {/* Who, where and when on one line, so the note under it is the
              first thing read. */}
            <p className="text-xs text-muted-foreground">
              {CHANNEL_LABELS[memo.channel]}
              {' · '}
              {formatDate(memo.occurredAt)}
              {' · '}
              {copy.summaryBy(memo.actorName)}
            </p>
            {/* The note as written, set apart the way a field shows its
              value and in the muted colour, so it reads as the source and
              the labelled issues under it as what was taken from it. */}
            {memo.transcript !== null && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {memo.transcript}
              </p>
            )}
            {memo.issues.length > 0 && (
              // One grid for every issue on the note, each `li` a subgrid row
              // of it, so the labels share one column and every value starts
              // at the same x however long "Issue 2" or "Wants" is. A phone
              // stacks each label over its value instead: a label column there
              // would leave the value a sliver of a 340px card. More space
              // between issues than inside one, so an issue and what the
              // person wants about it read as one entry.
              <ul
                aria-label={copy.issues}
                className="flex flex-col gap-5 sm:grid sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-5"
              >
                {memo.issues.map((issue, index) => (
                  // `flex-col` because globals.css makes every `li` under a
                  // data-slot ancestor a row flex box. Numbered once a note
                  // names more than one, the confirm form's own names for them.
                  <li
                    key={issue.position}
                    className="flex flex-col gap-2 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-baseline sm:gap-y-1"
                  >
                    <div className="flex flex-col gap-1 sm:contents">
                      <Overline emphasis={false}>
                        {memo.issues.length > 1
                          ? copy.issueNumber(index + 1)
                          : copy.issueHeading}
                      </Overline>
                      {/* The stance leads, so where the person stands is read
                          first and lines up down the card. No stance reads
                          as Unclear, as the report counts it: the same state
                          should not look like two. */}
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="soft" shape="pill">
                          {stanceLabels[issue.stance ?? 'unclear']}
                        </Badge>
                        <span className="text-sm text-foreground">
                          {issue.issueLabel}
                        </span>
                      </span>
                    </div>
                    {issue.desiredOutcome !== null && (
                      <div className="flex flex-col gap-1 sm:contents">
                        <Overline emphasis={false}>
                          {copy.wantsHeading}
                        </Overline>
                        <span className="text-sm text-foreground">
                          {issue.desiredOutcome}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}

export default MemoList
