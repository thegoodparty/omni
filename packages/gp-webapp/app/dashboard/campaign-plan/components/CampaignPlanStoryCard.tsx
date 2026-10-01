'use client'

import Link from 'next/link'
import { Button, Card, ScrollTextIcon } from '@styleguide'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'

// Pinned above the tracker rail while the Campaign Story is unfinished. The
// tracker also carries a "Tell us why you're running" task row, but that row
// sits in the Active phase, which is a collapsed accordion for a candidate
// still in Pre-launch — so the card is what guarantees the prompt is the first
// thing on the page. Not dismissible: a generic plan is the symptom and the
// story is the fix.
//
// Renders nothing while the story state is still resolving, so it never
// flashes in on an already-complete story.
export default function CampaignPlanStoryCard(): React.JSX.Element | null {
  const { isComplete, isLoading } = useCampaignStoryComplete(true)

  if (isLoading || isComplete) return null

  return (
    <Card className="mb-4 flex flex-col items-start gap-3 p-5 lg:p-6">
      <ScrollTextIcon className="size-6 text-primary" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-card-foreground">
          Tell us why you&apos;re running
        </h2>
        <p className="text-sm text-muted-foreground">
          Your plan gets sharper once we know your why, your background, and the
          issues you care about.
        </p>
      </div>
      <Button asChild className="rounded-full">
        {/* The manager auto-launches the story intake chat on this param. */}
        <Link href="/dashboard?personalize=1">Add your story</Link>
      </Button>
    </Card>
  )
}
