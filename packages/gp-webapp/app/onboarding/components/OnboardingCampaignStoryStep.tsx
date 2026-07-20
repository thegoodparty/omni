'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@styleguide'
import type { CampaignStory } from '@goodparty_org/contracts'
import type { WebsiteIssue } from 'helpers/types'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  getUserWebsite,
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import PolicyPriorities from 'app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities'
import { getBioPlainLength } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { CAMPAIGN_STORY_SECTIONS } from 'app/dashboard/campaign-story/sections'
import {
  isStoryFieldAnswered,
  useCampaignStory,
} from 'app/dashboard/campaign-story/useCampaignStory'
import CampaignStoryWhyCard from 'app/dashboard/campaign-story/components/CampaignStoryWhyCard'
import CampaignStoryCard from 'app/dashboard/campaign-story/components/CampaignStoryCard'

interface Props {
  onCompleteChange: (complete: boolean) => void
}

// Onboarding-chrome version of the Campaign Story cards (no DashboardLayout /
// FeatureFlagGuard wrapper). Fetches the same website (bio, issues) + story
// (background) the standalone page seeds server-side, then reuses the same cards
// which autosave on their own. Completion is reported up so OnboardingFlow can
// adapt the footer and fire generation.
export default function OnboardingCampaignStoryStep({
  onCompleteChange,
}: Props): React.JSX.Element {
  const { data: website, isError: isWebsiteError } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    refetchOnMount: 'always',
  })
  const { data: story, isError: isStoryError } = useCampaignStory()

  // A fetch failure must not mount the cards with empty data — a returning
  // candidate would see their saved story apparently lost and the footer would
  // silently latch "Skip for now". Surface the failure instead.
  const isError = isWebsiteError || isStoryError

  // The cards seed their editable state from initial* props via useState at
  // mount, read only once. Don't mount them until both fetches have resolved
  // (data present, or errored so a real failure doesn't hang forever), a
  // returning candidate's bio/background/issues must be in hand before first
  // render, the same way the standalone CampaignStoryPage gets them as
  // server-fetched props.
  const isReady =
    (website !== undefined || isWebsiteError) &&
    (story !== undefined || isStoryError)

  // While loading (or errored), the inner CampaignStoryStepCards isn't mounted,
  // so nothing else reports a value up. Report incomplete here; once isReady
  // flips true on the non-error path, the inner component's own effect takes
  // over.
  useEffect(() => {
    if (!isReady || isError) {
      onCompleteChange(false)
    }
  }, [isReady, isError, onCompleteChange])

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        We couldn&apos;t load your saved story. Check your connection and
        refresh the page to try again.
      </p>
    )
  }

  if (!isReady) {
    return <p className="text-sm text-muted-foreground">Loading your story…</p>
  }

  return (
    <CampaignStoryStepCards
      initialBio={website?.content?.about?.bio ?? ''}
      initialIssues={website?.content?.about?.issues ?? []}
      story={story}
      onCompleteChange={onCompleteChange}
    />
  )
}

interface CampaignStoryStepCardsProps {
  initialBio: string
  initialIssues: WebsiteIssue[]
  story: CampaignStory | undefined
  onCompleteChange: (complete: boolean) => void
}

// Mounted only once the fetches OnboardingCampaignStoryStep depends on have
// resolved, so the cards' useState(initial*) captures the real fetched values
// on first mount instead of the fetch's pre-resolution empty defaults.
function CampaignStoryStepCards({
  initialBio,
  initialIssues,
  story,
  onCompleteChange,
}: CampaignStoryStepCardsProps): React.JSX.Element {
  const { errorSnackbar } = useSnackbar()
  const [answered, setAnswered] = useState(() => ({
    why: getBioPlainLength(initialBio) > 0,
    background: isStoryFieldAnswered(story?.background),
  }))
  const [issues, setIssues] = useState<WebsiteIssue[]>(initialIssues)

  const complete = answered.why && answered.background && issues.length > 0
  useEffect(() => {
    onCompleteChange(complete)
  }, [complete, onCompleteChange])

  const handleIssuesChange = (next: WebsiteIssue[]): void => {
    const previous = issues
    setIssues(next)
    void saveAboutFields({ issues: next }).then((ok) => {
      if (!ok) {
        setIssues((current) => (current === next ? previous : current))
        errorSnackbar('Could not save your issues. Please try again.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <CampaignStoryWhyCard
        initialBio={initialBio}
        onAnsweredChange={(value) =>
          setAnswered((prev) =>
            prev.why === value ? prev : { ...prev, why: value },
          )
        }
      />
      {CAMPAIGN_STORY_SECTIONS.map((section) => (
        <CampaignStoryCard
          key={section.id}
          section={section}
          initialValue={story?.[section.id] ?? null}
          onAnsweredChange={(value) =>
            setAnswered((prev) =>
              prev.background === value ? prev : { ...prev, background: value },
            )
          }
        />
      ))}
      <Card className="p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold text-foreground">
            Your Policies
          </h3>
          <p className="text-sm text-muted-foreground">
            Two to four concrete fights for your first term. These are shared
            with your campaign website.
          </p>
        </div>
        <PolicyPriorities
          issues={issues}
          onChange={handleIssuesChange}
          hideToolbar
        />
      </Card>
    </div>
  )
}
