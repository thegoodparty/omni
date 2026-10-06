'use client'

import Link from 'next/link'
import { Card, ChevronRightIcon } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaignStoryComplete } from 'app/(dashboard)/campaign-story/useCampaignStoryComplete'

type OverviewCard = 'race' | 'story' | 'opponents'

interface CampaignPlanOverviewCardsProps {
  race: string
  // Already formatted, or '' when unknown.
  electionDate: string
}

const OverviewLink = ({
  card,
  href,
  title,
  summary,
}: {
  card: OverviewCard
  href: string
  title: string
  summary: string
}): React.JSX.Element => (
  <Link
    href={href}
    className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
    onClick={() =>
      trackEvent(EVENTS.Dashboard.CampaignPlan.OverviewCardClicked, { card })
    }
  >
    <Card className="h-full gap-2 rounded-2xl border border-grayscale-300 p-4 transition-colors group-hover:border-primary">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-card-foreground">
          {title}
        </h2>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>
    </Card>
  </Link>
)

/**
 * The top of the Game Plan: what the plan is built from, one card each for the
 * race, the candidate's story, and their opponents. Each opens the page where
 * the candidate can see all of it and change it, so the plan stays theirs.
 */
export default function CampaignPlanOverviewCards({
  race,
  electionDate,
}: CampaignPlanOverviewCardsProps): React.JSX.Element {
  const story = useCampaignStoryComplete(true)

  const raceSummary =
    [race, electionDate ? `Election Day ${electionDate}` : '']
      .filter(Boolean)
      .join(' · ') || 'Your office and election dates'

  // Says nothing about the story until it has loaded, rather than telling a
  // candidate who already wrote one to go add it.
  const storyMissing = !story.isLoading && !story.isError && !story.isComplete
  const storySummary = storyMissing
    ? 'Add yours to make this plan about you'
    : 'Why you’re running, your background, and your issues'

  return (
    <section
      aria-label="What your plan is built from"
      className="mb-8 grid gap-3 sm:grid-cols-3"
    >
      <OverviewLink
        card="race"
        href="/profile"
        title="Your race"
        summary={raceSummary}
      />
      <OverviewLink
        card="story"
        href="/campaign-story"
        title="Your story"
        summary={storySummary}
      />
      <OverviewLink
        card="opponents"
        href="/race-opponent"
        title="Your opponents"
        summary="Who you’re running against, and where you stand apart"
      />
    </section>
  )
}
