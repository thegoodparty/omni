import { useId } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../../../copy'
import MemoList from '../../../components/MemoList'

// The conversations behind the theme. Confirmed only, so none of them is
// waiting for review. On a text send they are the replies themselves.
const ThemeMemos = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => {
  const headingId = useId()
  // A theme page has no effort to read a channel from; its members say
  // where they came from, and a theme with none has nothing to list.
  const channel = theme.members[0]?.channel ?? 'door_knock'

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {whatWeHeardCopy(isServe).theNotes(channel)}
      </h2>
      <MemoList
        isServe={isServe}
        channel={channel}
        memos={theme.members.map((member) => ({
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
    </section>
  )
}

export default ThemeMemos
