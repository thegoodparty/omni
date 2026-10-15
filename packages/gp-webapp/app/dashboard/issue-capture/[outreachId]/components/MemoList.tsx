import type {
  ConstituentFeedbackIssue,
  FeedbackReportChannel,
} from '@goodparty_org/contracts'
import { Badge, Card, CardContent, EmptyState } from '@styleguide'
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
          <Card>
            <CardContent className="flex flex-col gap-3">
              {/* Who, where and when on one line, so the note under it is the
              first thing read. */}
              <p className="text-xs text-muted-foreground">
                {CHANNEL_LABELS[memo.channel]}
                {' · '}
                {formatDate(memo.occurredAt)}
                {' · '}
                {copy.summaryBy(memo.actorName)}
              </p>
              {/* The note as written, on the card itself and in the muted
              colour, so it reads as the source and the labelled issues in
              the panel under it as what was taken from it. */}
              {memo.transcript !== null && (
                <p className="text-sm text-muted-foreground">
                  {memo.transcript}
                </p>
              )}
              {memo.issues.length > 0 && (
                // One muted block per issue, 4px of the card between them and the
                // outer corners rounded, so each reads as its own item at any
                // width: what it is about and where the person stands on one line,
                // what they want under it, each value after its own quiet label.
                // On a phone each label sits on its own line with the stance
                // beside the issue's, and the value takes the full width under
                // it: beside a label column the values were a sliver. No stance
                // reads as Unclear, as the report counts it.
                <ul
                  aria-label={copy.issues}
                  className="flex flex-col gap-1 sm:grid sm:grid-cols-[auto_1fr_auto]"
                >
                  {memo.issues.map((issue, index) => (
                    // From `sm`, a subgrid row of the list's one grid of label,
                    // value and stance, so every "Issue:" and "Wants:" on the note share a
                    // column and every value starts at the same x, whichever
                    // issues have a want. `grid` also because globals.css makes
                    // every `li` under a data-slot ancestor a row flex box.
                    <li
                      key={issue.position}
                      className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-1 bg-muted px-3 py-2 text-sm first:rounded-t-lg last:rounded-b-lg sm:col-span-3 sm:grid-cols-subgrid"
                    >
                      {/* Numbered once a note names more than one, the confirm
                        form's own names for them. */}
                      <span className="order-1 text-muted-foreground sm:order-none">
                        {memo.issues.length > 1
                          ? copy.issueNumber(index + 1)
                          : copy.issueHeading}
                        :
                      </span>
                      <span className="order-3 col-span-2 text-foreground sm:order-none sm:col-span-1">
                        {issue.issueLabel}
                      </span>
                      {/* Right-aligned in its column, so badges of different
                        widths share the card's right edge. */}
                      <span className="order-2 justify-self-end sm:order-none">
                        <Badge variant="soft" shape="pill">
                          {stanceLabels[issue.stance ?? 'unclear']}
                        </Badge>
                      </span>
                      {issue.desiredOutcome !== null && (
                        <>
                          <span className="order-4 col-span-2 mt-1 text-muted-foreground sm:order-none sm:col-span-1 sm:mt-0">
                            {copy.wantsHeading}:
                          </span>
                          <span className="order-5 col-span-2 text-foreground sm:order-none">
                            {issue.desiredOutcome}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export default MemoList
