'use client'

import Link from 'next/link'
import { Card, ChevronRightIcon } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

type OverviewCard = 'race' | 'story' | 'opponents'

const OverviewLink = ({
  card,
  href,
  title,
}: {
  card: OverviewCard
  href: string
  title: string
}): React.JSX.Element => (
  <Link
    href={href}
    className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
    onClick={() =>
      trackEvent(EVENTS.Dashboard.CampaignPlan.OverviewCardClicked, { card })
    }
  >
    <Card className="h-full flex-row items-center justify-between gap-2 rounded-2xl border border-grayscale-300 p-4 transition-colors group-hover:border-primary">
      <h2 className="text-base font-semibold text-card-foreground">{title}</h2>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Card>
  </Link>
)

/**
 * The top of the Game Plan: what the plan is built from, one card each for the
 * race, the candidate's story, and their opponents. Each opens the page where
 * the candidate can see all of it and change it, so the plan stays theirs.
 */
export default function CampaignPlanOverviewCards(): React.JSX.Element {
  return (
    <section
      aria-label="What your plan is built from"
      className="mb-8 grid gap-3 sm:grid-cols-3"
    >
      <OverviewLink card="race" href="/race" title="Your race" />
      <OverviewLink card="story" href="/campaign-story" title="Your story" />
      <OverviewLink
        card="opponents"
        href="/race-opponent"
        title="Your opponents"
      />
    </section>
  )
}
