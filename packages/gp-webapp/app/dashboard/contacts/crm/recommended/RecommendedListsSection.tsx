import { useState } from 'react'
import { Button, LockIcon, ProBadge, Skeleton } from '@styleguide'
import type { RecommendedList } from '@goodparty_org/contracts'
import { useContactsTable } from '../ContactsTableProvider'
import { useShowContactProModal } from '../ContactProModal'
import RecommendedVoterListCard from './RecommendedVoterListCard'
import RecommendedListDetailSheet from './RecommendedListDetailSheet'
import { useRecommendedLists } from './useRecommendedLists'

// The "Recommended voter lists" section above the saved lists on the voter
// data page: the global recommended universes, before any channel is
// picked (docs/features/recommended-lists.md). Win-only twice over — the
// endpoint refuses an eo- org, and Serve has no outreach hub to send to —
// and gone entirely when nothing qualifies, since a heading over no cards
// reads as something broken.
export default function RecommendedListsSection() {
  const {
    isWinContext,
    isWinContextReady,
    canUseProFeatures,
    voterDataUnavailable,
    selectList,
  } = useContactsTable()
  const showProUpgradeModal = useShowContactProModal()
  const [openRecommendation, setOpenRecommendation] =
    useState<RecommendedList | null>(null)

  const isWin = isWinContextReady && isWinContext
  const { recommendations, isLoading, isError } = useRecommendedLists(
    isWin && canUseProFeatures && !voterDataUnavailable,
  )

  if (!isWin) return null

  // A recommendation the candidate has already saved opens that list's own
  // sheet, history included; one that exists nowhere yet gets the
  // recommendation sheet, which computes its figures from the filter.
  const handleDetails = (recommendation: RecommendedList) => {
    if (recommendation.existingFilterId !== null) {
      selectList(String(recommendation.existingFilterId))
      return
    }
    setOpenRecommendation(recommendation)
  }

  const body = !canUseProFeatures ? (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-6">
      <div className="flex items-center gap-2">
        <ProBadge />
        <span
          aria-label="Locked"
          className="inline-flex size-6 items-center justify-center rounded-full bg-primary-light text-muted-foreground"
        >
          <LockIcon className="size-3.5" />
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Recommended voter lists are a Pro feature. Upgrade to see who to reach
        and why.
      </p>
      <Button size="small" onClick={() => showProUpgradeModal(true)}>
        Upgrade
      </Button>
    </div>
  ) : isLoading ? (
    <div
      className="flex flex-col gap-3"
      data-testid="recommended-lists-loading"
      aria-busy="true"
    >
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
    </div>
  ) : isError ? (
    <p className="text-sm text-destructive">
      We couldn&apos;t load recommendations right now.
    </p>
  ) : recommendations.length === 0 ? null : (
    <div className="flex flex-col gap-3">
      {recommendations.map((recommendation) => (
        <RecommendedVoterListCard
          key={recommendation.variant}
          recommendation={recommendation}
          onDetails={() => handleDetails(recommendation)}
        />
      ))}
    </div>
  )

  if (body === null) return null

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Recommended voter lists</h2>
        <p className="text-sm text-muted-foreground">
          Voter lists in your district who are likely to support your campaign.
        </p>
      </div>
      {body}
      <RecommendedListDetailSheet
        recommendation={openRecommendation}
        onClose={() => setOpenRecommendation(null)}
      />
    </section>
  )
}
