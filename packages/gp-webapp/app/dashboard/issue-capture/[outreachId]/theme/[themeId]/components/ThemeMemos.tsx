import { useId, useState } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'
import MemoList from '../../../components/MemoList'

// The report's All notes rule: the newest ten, the rest behind Show more.
const VISIBLE_NOTES = 10

// The conversations behind the theme. Confirmed only. On a text send they
// are the replies themselves.
const ThemeMemos = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  // A theme page has no effort to read a channel from; its members say
  // where they came from, and a theme with none has nothing to list.
  const channel = theme.members[0]?.channel ?? 'door_knock'
  // A text send lists every reply, as the report does.
  const members =
    expanded || channel === 'text'
      ? theme.members
      : theme.members.slice(0, VISIBLE_NOTES)
  const hidden = theme.members.length - members.length

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {copy.theNotes(channel)}
      </h2>
      <MemoList
        isServe={isServe}
        channel={channel}
        memos={members.map((member) => ({
          // Exactly one of the two is set.
          id: member.feedbackId ?? member.textReplyId ?? '',
          transcript: member.transcript,
          issues: member.issues,
          actorName: member.actorName,
          channel: member.channel,
          occurredAt: member.occurredAt,
          pending: false,
        }))}
      />
      {hidden > 0 && (
        <div className="mt-1 flex justify-center">
          <Button
            variant="outline"
            size="small"
            onClick={() => setExpanded(true)}
          >
            {copy.showMoreNotes(hidden)}
          </Button>
        </div>
      )}
    </section>
  )
}

export default ThemeMemos
