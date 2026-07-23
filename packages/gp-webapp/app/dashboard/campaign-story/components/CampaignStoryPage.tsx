'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import H2 from '@shared/typography/H2'
import { BookOpenIcon, Button } from '@styleguide'
import { CAMPAIGN_STORY_FLAG_KEY } from '@shared/experiments/campaignStoryFlag'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { WebsiteIssue } from 'helpers/types'
import {
  getUserWebsite,
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { CAMPAIGN_STORY_QUERY_KEY, useCampaignStory } from '../useCampaignStory'
import StoryIntakeCard from 'app/onboarding/components/StoryIntakeCard'
import StoryIssuesCard from 'app/onboarding/components/StoryIssuesCard'
import {
  STORY_WHY_QUESTION,
  STORY_BACKGROUND_QUESTION,
  WHY_EXAMPLE_PLACEHOLDER,
  BACKGROUND_EXAMPLE_PLACEHOLDER,
} from 'app/onboarding/components/storyStepCopy'

interface CampaignStoryPageProps {
  pathname?: string
}

// The standalone "Your story" dashboard page. Reuses the same onboarding story
// cards (StoryIntakeCard for why/background, StoryIssuesCard for the policy
// priorities), but each card persists on its own via a Save button rather than
// deferring to a final step — this is a single editable page, not a flow.
const CampaignStoryPage = ({
  pathname,
}: CampaignStoryPageProps): React.JSX.Element => {
  return (
    <FeatureFlagGuard flagKey={CAMPAIGN_STORY_FLAG_KEY}>
      <DashboardLayout
        pathname={pathname}
        wrapperClassName="w-full"
        showAlert={false}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <header className="flex items-center gap-2">
            <BookOpenIcon className="size-6" />
            <H2>Your story</H2>
          </header>

          <p className="text-base text-muted-foreground">
            This is what personalizes your Campaign Plan, Campaign Tracker, and
            your GoodParty.org experience.
          </p>

          <StoryEditor />
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

// Fetches the saved story, then mounts the editable form once (so its useState
// seeds from the real values, not the pre-resolution empty defaults).
const StoryEditor = (): React.JSX.Element => {
  const { data: website, isError: isWebsiteError } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
    refetchOnMount: 'always',
  })
  const { data: story, isError: isStoryError } = useCampaignStory()

  const isError = isWebsiteError || isStoryError
  const isReady =
    (website !== undefined || isWebsiteError) &&
    (story !== undefined || isStoryError)

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
    <StoryEditorForm
      initialBio={website?.content?.about?.bio ?? ''}
      initialBackground={story?.background ?? ''}
      initialIssues={website?.content?.about?.issues ?? []}
    />
  )
}

interface StoryEditorFormProps {
  initialBio: string
  initialBackground: string
  initialIssues: WebsiteIssue[]
}

function StoryEditorForm({
  initialBio,
  initialBackground,
  initialIssues,
}: StoryEditorFormProps): React.JSX.Element {
  const { errorSnackbar } = useSnackbar()
  const queryClient = useQueryClient()

  // The why is edited as plain text and stored as the website bio (a returning
  // candidate's HTML bio is stripped to plain for the textarea).
  const [why, setWhy] = useState(() =>
    initialBio ? stripHtml(initialBio).result.trim() : '',
  )
  const [savedWhy, setSavedWhy] = useState(why)
  const [savingWhy, setSavingWhy] = useState(false)
  const saveWhy = async (): Promise<void> => {
    if (savingWhy || why === savedWhy) return
    setSavingWhy(true)
    const ok = await saveAboutFields({ bio: why })
    if (ok) {
      setSavedWhy(why)
      void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } else {
      errorSnackbar('Could not save your answer. Please try again.')
    }
    setSavingWhy(false)
  }

  const [background, setBackground] = useState(initialBackground)
  const [savedBackground, setSavedBackground] = useState(initialBackground)
  const [savingBackground, setSavingBackground] = useState(false)
  const saveBackground = async (): Promise<void> => {
    if (savingBackground || background === savedBackground) return
    setSavingBackground(true)
    try {
      await clientRequest('PUT /v1/campaigns/mine/story', { background })
      setSavedBackground(background)
      void queryClient.invalidateQueries({ queryKey: CAMPAIGN_STORY_QUERY_KEY })
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'CampaignStoryPage.saveBackground',
      })
      errorSnackbar('Could not save your answer. Please try again.')
    }
    setSavingBackground(false)
  }

  const [issues, setIssues] = useState<WebsiteIssue[]>(initialIssues)
  const [savedIssues, setSavedIssues] = useState<WebsiteIssue[]>(initialIssues)
  const [savingIssues, setSavingIssues] = useState(false)
  const issuesDirty = JSON.stringify(issues) !== JSON.stringify(savedIssues)
  const saveIssues = async (): Promise<void> => {
    if (savingIssues || !issuesDirty) return
    setSavingIssues(true)
    const ok = await saveAboutFields({ issues })
    if (ok) {
      setSavedIssues(issues)
      void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } else {
      errorSnackbar('Could not save your issues. Please try again.')
    }
    setSavingIssues(false)
  }

  const complete =
    savedWhy.trim().length > 0 &&
    savedBackground.trim().length > 0 &&
    savedIssues.length > 0

  return (
    <div className="flex flex-col gap-8">
      <StoryIntakeCard
        question={STORY_WHY_QUESTION}
        examplePlaceholder={WHY_EXAMPLE_PLACEHOLDER}
        value={why}
        onChange={setWhy}
        rewriteField="why"
        analyticsLabel="dashboard_story_why"
        save={{
          isDirty: why !== savedWhy,
          isSaving: savingWhy,
          hasSavedContent: savedWhy.trim().length > 0,
          onSave: () => void saveWhy(),
        }}
      />

      <StoryIntakeCard
        question={STORY_BACKGROUND_QUESTION}
        examplePlaceholder={BACKGROUND_EXAMPLE_PLACEHOLDER}
        value={background}
        onChange={setBackground}
        rewriteField="background"
        analyticsLabel="dashboard_story_background"
        save={{
          isDirty: background !== savedBackground,
          isSaving: savingBackground,
          hasSavedContent: savedBackground.trim().length > 0,
          onSave: () => void saveBackground(),
        }}
      />

      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-foreground">
          What issues do you most want to solve?
        </h2>
        <StoryIssuesCard
          issues={issues}
          onChange={setIssues}
          save={{
            isDirty: issuesDirty,
            isSaving: savingIssues,
            hasSavedContent: issues.length > 0,
            onSave: () => void saveIssues(),
          }}
        />
      </div>

      {complete && (
        <div className="sticky bottom-4 z-10 flex flex-col items-stretch gap-3 rounded-xl border border-border bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium text-foreground">
            Your Campaign Story is ready.
          </span>
          <Button asChild className="sm:shrink-0">
            <Link href="/dashboard/campaign-plan">
              Go to your Campaign Tracker
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}

export default CampaignStoryPage
