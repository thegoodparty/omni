import { useId } from 'react'
import type { FeedbackReportChannel } from '@goodparty_org/contracts'
import { whatWeHeardCopy } from '../../copy'
import DownloadNotesLink from './DownloadNotesLink'
import MemoList, { type MemoListItem } from './MemoList'

// Under the floor there are no themes, only the notes. Grouping a handful of
// conversations would produce exactly the misleading share the report exists
// to avoid, so the page says when themes will appear instead.
const UnderFloorList = ({
  floor,
  memos,
  channel,
  outreachId,
  isServe,
}: {
  floor: number
  memos: MemoListItem[]
  channel: FeedbackReportChannel
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-foreground">
            {copy.soFarHeading}
          </h2>
          <p className="text-sm text-muted-foreground">
            {copy.floorLine(floor, channel)}
          </p>
        </div>
        {/* The export is the canvassers' notes; a text send's replies are
            already a file on the results page that received them. */}
        {channel !== 'text' && (
          <DownloadNotesLink
            outreachId={outreachId}
            hasNotes={memos.length > 0}
            isServe={isServe}
          />
        )}
      </div>
      <MemoList memos={memos} channel={channel} isServe={isServe} />
    </section>
  )
}

export default UnderFloorList
