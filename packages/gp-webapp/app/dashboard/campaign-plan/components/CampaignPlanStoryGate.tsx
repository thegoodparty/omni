'use client'

import Link from 'next/link'
import { Button, Card, ScrollTextIcon, SparklesIcon } from '@styleguide'
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
  const story = useCampaignStory()

  if (story === undefined) {
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
            Your campaign plan starts with your story
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
          Ready to build your campaign plan
        </h2>
        <p className="text-muted-foreground">
          We&apos;ll use your Campaign Story to generate a plan tailored to your
          race.
        </p>
      </div>
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
        <Button onClick={onGenerate} icon={<SparklesIcon />}>
          I&apos;m ready, Generate my Plan
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/dashboard/campaign-story">
            Give me a moment, I want to update my Story first
          </Link>
        </Button>
      </div>
    </Card>
  )
}

export default CampaignPlanStoryGate
