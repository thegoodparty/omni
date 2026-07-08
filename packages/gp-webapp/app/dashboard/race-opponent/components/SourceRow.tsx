import type { SummarySource } from '@goodparty_org/contracts'
import SourceChip, { type SourceChipNonLinkedSource } from './SourceChip'

type Props = {
  sources: SummarySource[]
  nonLinkedSource?: SourceChipNonLinkedSource
}

// The "source:" italic label + chip pairing every redesigned brief section
// uses, so sections don't each re-implement the row layout. Renders nothing
// when there is no citation to show.
const SourceRow = ({
  sources,
  nonLinkedSource,
}: Props): React.JSX.Element | null => {
  if (sources.length === 0 && !nonLinkedSource) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="italic text-muted-foreground">source:</span>
      <SourceChip sources={sources} nonLinkedSource={nonLinkedSource} />
    </div>
  )
}

export default SourceRow
