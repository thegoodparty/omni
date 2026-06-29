'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import { Button, Card, ScrollTextIcon, SparklesIcon } from '@styleguide'
import AlertDialog from '@shared/utils/AlertDialog'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
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
  // Issues live on the website (shared with Pro-upgrade), not the story.
  const {
    data: website,
    isLoading: websiteLoading,
    isError: websiteIsError,
  } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    // Always refetch on mount: a candidate who just edited issues on the story
    // page (a direct saveAboutFields write that doesn't touch this cache) must
    // see them here, not a stale within-staleTime snapshot that would wrongly
    // gate them. Mirrors useCampaignStory's refetch for the story fields.
    refetchOnMount: 'always',
  })
  const issues = website?.content?.about?.issues ?? []
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Only spin while genuinely loading — an errored fetch leaves data undefined
  // forever, so fall through (fail closed) to the "complete your story" prompt
  // rather than spinning indefinitely.
  if (
    (story === undefined && !isError) ||
    (websiteLoading && !websiteIsError)
  ) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  // Fail open on a website-fetch error: don't read it as "no issues" and block
  // a candidate who actually has a complete story with real issues.
  if (!isCampaignStoryComplete(story, websiteIsError || issues.length > 0)) {
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
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">
            Your issues
          </span>
          <ul className="flex flex-col gap-2">
            {issues.map((issue, index) => (
              <li key={index} className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {issue.title}
                </span>
                <span className="text-sm text-muted-foreground">
                  {issue.description ? stripHtml(issue.description).result : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
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
