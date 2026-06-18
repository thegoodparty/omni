'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, Card, ScrollTextIcon, SparklesIcon } from '@styleguide'
import AlertDialog from '@shared/utils/AlertDialog'
import { CAMPAIGN_STORY_SECTIONS } from 'app/dashboard/campaign-story/sections'
import {
  isCampaignStoryComplete,
  useCampaignStory,
} from 'app/dashboard/campaign-story/useCampaignStory'

interface CampaignPlanStoryGateProps {
  onGenerate: () => void
}

const CARD_CLASS = 'mx-auto flex max-w-2xl flex-col items-start gap-4 p-8'

const CampaignPlanStoryGate = ({
  onGenerate,
}: CampaignPlanStoryGateProps): React.JSX.Element => {
  const { data: story, isError } = useCampaignStory()
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Only spin while genuinely loading — an errored fetch leaves data undefined
  // forever, so fall through (fail closed) to the "complete your story" prompt
  // rather than spinning indefinitely.
  if (story === undefined && !isError) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  if (!isCampaignStoryComplete(story)) {
    return (
      <Card className={CARD_CLASS}>
        <ScrollTextIcon className="size-8 text-primary" />
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold text-foreground">
            Your Campaign Plan starts with your story
          </h2>
          <p className="text-muted-foreground">
            We build your personalized plan from your why, your background, and
            the issues you&apos;ll fight for. Complete your Campaign Story and
            we&apos;ll generate your plan from it.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/campaign-story">Go to Campaign Story</Link>
        </Button>
      </Card>
    )
  }

  return (
    <Card className={CARD_CLASS}>
      <ScrollTextIcon className="size-8 text-primary" />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Ready to build your Campaign Plan
        </h2>
        <p className="text-muted-foreground">
          We&apos;ll generate your plan from your Campaign Story below. Give it
          a final look — edit anything before we start.
        </p>
      </div>

      <div className="flex w-full flex-col gap-4">
        {CAMPAIGN_STORY_SECTIONS.map(({ id, title }) => (
          <div key={id} className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {story[id]}
            </p>
          </div>
        ))}
      </div>

      <div className="flex w-full flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
        <Button onClick={() => setConfirmOpen(true)} icon={<SparklesIcon />}>
          Generate my Campaign Plan
        </Button>
        <Button variant="ghost" className="sm:ml-auto" asChild>
          <Link href="/dashboard/campaign-story">Edit my Story</Link>
        </Button>
      </div>

      <AlertDialog
        open={confirmOpen}
        handleClose={() => setConfirmOpen(false)}
        handleProceed={() => {
          setConfirmOpen(false)
          onGenerate()
        }}
        redButton={false}
        title="Are you sure you're ready?"
        description="It's important that your story is fully complete before we generate your plan, for the best results."
        proceedLabel="Yes, generate my plan"
        cancelLabel="Not yet"
      />
    </Card>
  )
}

export default CampaignPlanStoryGate
