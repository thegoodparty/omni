import { useId } from 'react'
import { whatWeHeardCopy } from '../../copy'
import DownloadNotesLink from './DownloadNotesLink'
import MemoList, { type MemoListItem } from './MemoList'

// Under the floor there are no themes, only the notes. Grouping a handful of
// conversations would produce exactly the misleading share the report exists
// to avoid, so the Summarize button is off, and its tooltip says when themes
// will appear.
const UnderFloorList = ({
  memos,
  outreachId,
  isServe,
}: {
  memos: MemoListItem[]
  outreachId: number
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          {copy.soFarHeading}
        </h2>
        <DownloadNotesLink
          outreachId={outreachId}
          hasNotes={memos.length > 0}
          isServe={isServe}
        />
      </div>
      <MemoList memos={memos} outreachId={outreachId} isServe={isServe} />
    </section>
  )
}

export default UnderFloorList
