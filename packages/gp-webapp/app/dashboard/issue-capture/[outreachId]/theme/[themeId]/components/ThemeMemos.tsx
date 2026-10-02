import { useId } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../../../copy'
import MemoList from '../../../components/MemoList'

// The conversations behind the theme. Confirmed only, so none of them is
// waiting for review.
const ThemeMemos = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {whatWeHeardCopy(isServe).theNotes}
      </h2>
      <MemoList
        isServe={isServe}
        memos={theme.members.map((member) => ({
          id: member.feedbackId,
          transcript: member.transcript,
          stance: member.stance,
          desiredOutcome: member.desiredOutcome,
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
