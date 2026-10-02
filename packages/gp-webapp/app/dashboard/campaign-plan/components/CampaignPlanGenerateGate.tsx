'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, ScrollTextIcon, SparklesIcon } from '@styleguide'
import AlertDialog from '@shared/utils/AlertDialog'
import { issueDescriptionText } from '@shared/utils/issueDescriptionText'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { getBioPlainLength } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { CAMPAIGN_STORY_SECTIONS } from 'app/dashboard/campaign-story/sections'
import {
  isCampaignStoryComplete,
  isStoryFieldAnswered,
  useCampaignStory,
} from 'app/dashboard/campaign-story/useCampaignStory'

interface CampaignPlanGenerateGateProps {
  onGenerate: () => void
}

const CARD_CLASS = 'mx-auto flex max-w-2xl flex-col items-start gap-4 p-8'

const CampaignPlanGenerateGate = ({
  onGenerate,
}: CampaignPlanGenerateGateProps): React.JSX.Element => {
  const { data: story, isError } = useCampaignStory()
  // The "why" (bio) and issues live on the website (shared with Pro-upgrade),
  // not the story.
  const {
    data: website,
    isLoading: websiteLoading,
    isError: websiteIsError,
  } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    // Always refetch on mount: a candidate who just edited their why or issues
    // on the story page (a direct saveAboutFields write that doesn't touch this
    // cache) must see them here, not a stale within-staleTime snapshot.
    refetchOnMount: 'always',
  })
  const bio = website?.content?.about?.bio ?? ''
  const issues = website?.content?.about?.issues ?? []
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Only spin while genuinely loading — an errored fetch leaves data undefined
  // forever, so fall through and offer generation rather than spinning.
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

  const hasBio = getBioPlainLength(bio) > 0
  // Fail open on a website-fetch error: don't read it as "no why / no issues".
  const storyComplete = isCampaignStoryComplete(
    story,
    websiteIsError || hasBio,
    websiteIsError || issues.length > 0,
  )

  return (
    <Card className={CARD_CLASS}>
      <ScrollTextIcon className="size-8 text-primary" />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Ready to build your Campaign Plan
        </h2>
        <p className="text-muted-foreground">
          {storyComplete
            ? 'Give your story a final look and edit anything before we start.'
            : 'You can add your story any time to make your plan sharper.'}
        </p>
      </div>

      <div className="flex w-full flex-col gap-4">
        {hasBio && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">
              Your why
            </span>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {issueDescriptionText(bio)}
            </p>
          </div>
        )}
        {CAMPAIGN_STORY_SECTIONS.filter(({ id }) =>
          isStoryFieldAnswered(story?.[id]),
        ).map(({ id, title }) => (
          <div key={id} className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {story?.[id]}
            </p>
          </div>
        ))}
        {issues.length > 0 && (
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
                    {issue.description
                      ? issueDescriptionText(issue.description)
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
        <Button onClick={() => setConfirmOpen(true)} icon={<SparklesIcon />}>
          Generate my Campaign Plan
        </Button>
        <Button variant="ghost" className="sm:ml-auto" asChild>
          <Link href="/dashboard?personalize=1">
            {storyComplete ? 'Edit in campaign manager' : 'Add your story'}
          </Link>
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
        description={
          storyComplete
            ? "It's important that your story is fully complete before we generate your plan, for the best results."
            : "We'll build your plan from your race. You can add your story later."
        }
        proceedLabel="Yes, generate my plan"
        cancelLabel="Not yet"
      />
    </Card>
  )
}

export default CampaignPlanGenerateGate
