import Body2 from '@shared/typography/Body2'
import { formatFencedCount } from '../shared/formatFencedCount.util'

interface OverlapBarProps {
  overlapCount: number
  overlapFenced: boolean | undefined
  liveCount: number
  liveFenced: boolean | undefined
  peopleNoun: string
}

// The saved-list overlap strip (ENG-10840): "N (P%) voters already exist in
// lists you've saved.", rendered directly above the wizard's "Build your
// list (N)" CTA once a pill is selected and the org has at least one saved
// list (gating lives in CreateListWizard). Percent is computed client-side
// against the wizard's own (possibly fenced) live count — a fenced overlap
// OR a fenced live count suppresses the percent (dividing by a floor would
// misstate it) and the count still renders via the "10,000+" convention.
export default function OverlapBar({
  overlapCount,
  overlapFenced,
  liveCount,
  liveFenced,
  peopleNoun,
}: OverlapBarProps) {
  const suppressPercent = overlapFenced || liveFenced || liveCount === 0
  const percent = suppressPercent
    ? null
    : Math.round((overlapCount / liveCount) * 100)

  return (
    <Body2 className="w-full text-muted-foreground" aria-live="polite">
      {formatFencedCount(overlapCount, overlapFenced)}
      {percent !== null ? ` (${percent}%)` : ''} {peopleNoun} already exist in
      lists you&apos;ve saved.
    </Body2>
  )
}
