'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { Button, Card, CheckIcon } from '@styleguide'
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

// Shared sub-line under each card's question on the dashboard page.
const CARD_DESCRIPTION =
  "We'll use this to draft your voter outreach and personalize your campaign plan."

interface CampaignStoryPageProps {
  pathname?: string
}

// The page-title + Save band. It sits on the gray content surface (no white
// background — the full-bleed white header component is a follow-up); the
// negative margins cancel DashboardLayout's content padding (`p-2 md:p-4`) so
// the band + its bottom border run edge-to-edge. Rendered by both the
// loading/error states and the editable form so the header stays put while the
// body swaps.
const StoryHeaderBar = ({
  action,
}: {
  action?: React.ReactNode
}): React.JSX.Element => (
  <div className="sticky top-0 z-10 -mx-2 -mt-2 flex items-center justify-between gap-3 border-b border-base-border bg-base-muted px-4 py-3 sm:px-8 md:-mx-4 md:-mt-4">
    <h2 className="text-xl font-semibold leading-snug text-foreground">
      Your story
    </h2>
    {action}
  </div>
)

// The standalone "Your story" dashboard page. Reuses the same onboarding story
// cards (StoryIntakeCard for why/background, StoryIssuesCard for the policy
// priorities). Unlike onboarding, it's a single editable page: one page-level
// Save in the header commits every field at once, and a "Start over" clears
// them (Save still being the only thing that persists).
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
        <StoryEditor />
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

const StoryBody = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-8">
    {children}
  </div>
)

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
      <>
        <StoryHeaderBar />
        <StoryBody>
          <p className="text-sm text-destructive">
            We couldn&apos;t load your saved story. Check your connection and
            refresh the page to try again.
          </p>
        </StoryBody>
      </>
    )
  }

  if (!isReady) {
    return (
      <>
        <StoryHeaderBar />
        <StoryBody>
          <p className="text-sm text-muted-foreground">Loading your story…</p>
        </StoryBody>
      </>
    )
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

// Exported for testing — the save wiring (per-field dirty/save, error snackbar,
// cache invalidation, completeness banner) lives here.
export function StoryEditorForm({
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

  const anySaving = savingWhy || savingBackground || savingIssues
  const anyDirty =
    why !== savedWhy || background !== savedBackground || issuesDirty
  // Drives the "Start over" affordance: only offered once the candidate has
  // entered something to clear.
  const anyContent =
    why.trim().length > 0 || background.trim().length > 0 || issues.length > 0

  // The header Save commits every dirty field in one click. Each save* is a
  // no-op when its field is unchanged, so this only writes what actually moved.
  const saveAll = async (): Promise<void> => {
    if (anySaving || !anyDirty) return
    await saveWhy()
    await saveBackground()
    await saveIssues()
  }

  // Clears the fields in memory only; nothing is deleted until the candidate
  // Saves (the empty state), matching the explicit-save model.
  const startOver = (): void => {
    setWhy('')
    setBackground('')
    setIssues([])
  }

  const complete =
    savedWhy.trim().length > 0 &&
    savedBackground.trim().length > 0 &&
    savedIssues.length > 0

  return (
    <>
      <StoryHeaderBar
        action={
          <Button
            className="rounded-full"
            icon={<CheckIcon />}
            loading={anySaving}
            loadingText="Saving…"
            disabled={!anyDirty || anySaving}
            onClick={() => void saveAll()}
          >
            Save
          </Button>
        }
      />

      <StoryBody>
        <p className="text-base text-muted-foreground">
          The foundation we build everything else on: your why, your background,
          and the issues you&apos;ll fight for. Your answers personalize your
          campaign plan, stump speech, and voter messages.
        </p>

        <StoryIntakeCard
          question={STORY_WHY_QUESTION}
          description={CARD_DESCRIPTION}
          examplePlaceholder={WHY_EXAMPLE_PLACEHOLDER}
          value={why}
          onChange={setWhy}
          rewriteField="why"
          analyticsLabel="dashboard_story_why"
        />

        <StoryIntakeCard
          question={STORY_BACKGROUND_QUESTION}
          description={CARD_DESCRIPTION}
          examplePlaceholder={BACKGROUND_EXAMPLE_PLACEHOLDER}
          value={background}
          onChange={setBackground}
          rewriteField="background"
          analyticsLabel="dashboard_story_background"
        />

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-foreground">
              What issues do you most want to solve if elected?
            </h2>
            <p className="text-base text-muted-foreground">
              {CARD_DESCRIPTION}
            </p>
          </div>
          <StoryIssuesCard issues={issues} onChange={setIssues} />
        </Card>

        {anyContent && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={startOver}
              className="rounded-full px-4 py-2 text-base font-medium text-link transition-colors hover:bg-link/10"
            >
              Start over
            </button>
          </div>
        )}

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
      </StoryBody>
    </>
  )
}

export default CampaignStoryPage
