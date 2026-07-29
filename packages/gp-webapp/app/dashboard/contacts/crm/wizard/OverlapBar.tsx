import { formatFencedCount } from '../shared/formatFencedCount.util'

interface OverlapBarProps {
  overlapCount: number
  overlapFenced: boolean | undefined
  liveCount: number
  liveFenced: boolean | undefined
  peopleNoun: string
}

// The saved-list overlap strip (ENG-10840): "N (P%) voters already exist in
// lists you've saved.", rendered as a full-bleed gray band (CrmSheet's
// `banner` slot) directly above the wizard footer once a pill is selected
// and the org has at least one saved list (gating lives in CreateListWizard).
// Percent is computed client-side against the wizard's own (possibly fenced)
// live count — a fenced overlap OR a fenced live count suppresses the percent
// (dividing by a floor would misstate it) and the count still renders via the
// "10,000+" convention. The copy after the count lives in template literals,
// not JSXText: SWC/Turbopack drops the leading space of a text node that
// follows an expression (vite/jsdom keeps it), which shipped as
// "votersalready" while the unit test passed.
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
    <div className="w-full border-y border-border bg-muted" aria-live="polite">
      <p className="mx-auto w-full max-w-[608px] px-4 py-2.5 text-xs text-muted-foreground md:px-0">
        <span className="font-semibold text-foreground">
          {formatFencedCount(overlapCount, overlapFenced)}
        </span>
        {percent !== null ? ` (${percent}%)` : ''}
        {` ${peopleNoun} already exist in lists you've saved.`}
      </p>
    </div>
  )
}
