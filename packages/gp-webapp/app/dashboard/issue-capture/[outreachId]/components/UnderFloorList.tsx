import { useId } from 'react'
import { whatWeHeardCopy } from '../../copy'
import MemoList, { type MemoListItem } from './MemoList'

// Under the floor there are no themes, only the notes. Grouping a handful of
// conversations would produce exactly the misleading share the report exists
// to avoid, so the page says when themes will appear instead.
const UnderFloorList = ({
  floor,
  memos,
  isServe,
}: {
  floor: number
  memos: MemoListItem[]
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 id={headingId} className="text-lg font-semibold text-foreground">
          {copy.soFarHeading}
        </h2>
        <p className="text-sm text-muted-foreground">{copy.floorLine(floor)}</p>
      </div>
      <MemoList memos={memos} isServe={isServe} />
    </section>
  )
}

export default UnderFloorList
