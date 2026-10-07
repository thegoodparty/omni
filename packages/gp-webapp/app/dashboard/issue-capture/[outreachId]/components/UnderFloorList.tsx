import { useId } from 'react'
import { whatWeHeardCopy } from '../../copy'
import MemoList, { type MemoListItem } from './MemoList'

// Under the floor there are no themes, only the notes. Grouping a handful of
// conversations would produce exactly the misleading share the report exists
// to avoid, so the Summarize button is off, and its tooltip says when themes
// will appear.
const UnderFloorList = ({
  memos,
  isServe,
}: {
  memos: MemoListItem[]
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        {copy.soFarHeading}
      </h2>
      <MemoList memos={memos} isServe={isServe} />
    </section>
  )
}

export default UnderFloorList
