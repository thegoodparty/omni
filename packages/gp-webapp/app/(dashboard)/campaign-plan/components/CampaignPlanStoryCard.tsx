'use client'

import Link from 'next/link'
import { Button, Card, ScrollTextIcon } from '@styleguide'
import { useCampaignStoryComplete } from 'app/(dashboard)/campaign-story/useCampaignStoryComplete'

// Pinned above the tracker rail while the Campaign Story is unfinished, and
// sized like the dashboard's Pro banner: one card, one CTA, no competing
// actions. The tracker carries a story task too, but that row sits at the end
// of pre-launch, so the card is what makes this the first thing on the page
// and says plainly why it is worth doing.
//
// Not dismissible: a generic plan is the symptom and the story is the fix.
//
// Renders nothing while the story state is still resolving, so it never
// flashes in on an already-complete story — and nothing on an error either.
// `useCampaignStoryComplete` fails closed on a story-fetch error (the data
// stays undefined, so `isComplete` is false forever), which on an
// undismissable card would mean telling a candidate who already wrote their
// story to go add it, permanently. Staying silent is the safer miss: the
// tracker's own story task still carries the prompt.
export default function CampaignPlanStoryCard(): React.JSX.Element | null {
  const { isComplete, isLoading, isError } = useCampaignStoryComplete(true)

  if (isLoading || isError || isComplete) return null

  return (
    <Card className="relative mb-4 gap-0 overflow-hidden p-6">
      <div className="flex flex-col items-start gap-3">
        <ScrollTextIcon className="size-8 text-primary" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="font-opensans text-lg font-semibold text-card-foreground">
            Tell us your campaign story
          </h2>
          <p className="font-opensans text-sm text-card-foreground">
            Share your why, your background, and the issues you care about to
            sharpen your plan.
          </p>
        </div>
        <div className="pt-3">
          <Button asChild>
            {/* The manager auto-launches the story intake chat on this param. */}
            <Link href="/home?personalize=1">Add your story</Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}
