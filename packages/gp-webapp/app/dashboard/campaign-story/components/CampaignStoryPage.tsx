'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import DashboardLayout from '../../shared/DashboardLayout'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import { NAV_LABELS } from '../../shared/navLabels'
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

// The standalone "Your story" dashboard page. Reuses the same onboarding story
// cards (StoryIntakeCard for why/background, StoryIssuesCard for the policy
// priorities). Unlike onboarding, it's a single editable page: one page-level
// Save in the title bar commits every field at once, and a "Start over" clears
// them (Save still being the only thing that persists).
//
// The page title comes from DashboardLayout's navHeader — the shared bar every
// main nav page uses — so it carries the same icon and name as the sidebar tab.
// The form's Save portals into that bar (see StoryEditorForm).
const CampaignStoryPage = ({
  pathname,
}: CampaignStoryPageProps): React.JSX.Element => {
  return (
    <FeatureFlagGuard flagKey={CAMPAIGN_STORY_FLAG_KEY}>
      <DashboardLayout
        pathname={pathname}
        wrapperClassName="w-full"
        showAlert={false}
        navHeader={{
          icon: 'book',
          label: NAV_LABELS.campaignStory,
          hasAction: true,
        }}
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
      <StoryBody>
        <p className="text-sm text-destructive">
          We couldn&apos;t load your saved story. Check your connection and
          refresh the page to try again.
        </p>
      </StoryBody>
    )
  }

  if (!isReady) {
    return (
      <StoryBody>
        <p className="text-sm text-muted-foreground">Loading your story…</p>
      </StoryBody>
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
  // Each save returns whether it succeeded (a clean no-op counts as success) so
  // saveAll can stop on the first failure instead of writing later fields.
  const saveWhy = async (): Promise<boolean> => {
    if (savingWhy || why === savedWhy) return true
    setSavingWhy(true)
    const ok = await saveAboutFields({ bio: why })
    if (ok) {
      setSavedWhy(why)
      void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } else {
      errorSnackbar('Could not save your answer. Please try again.')
    }
    setSavingWhy(false)
    return ok
  }

  const [background, setBackground] = useState(initialBackground)
  const [savedBackground, setSavedBackground] = useState(initialBackground)
  const [savingBackground, setSavingBackground] = useState(false)
  const saveBackground = async (): Promise<boolean> => {
    if (savingBackground || background === savedBackground) return true
    setSavingBackground(true)
    let ok = true
    try {
      await clientRequest('PUT /v1/campaigns/mine/story', { background })
      setSavedBackground(background)
      void queryClient.invalidateQueries({ queryKey: CAMPAIGN_STORY_QUERY_KEY })
    } catch (error) {
      ok = false
      reportErrorToSentry(error, {
        context: 'CampaignStoryPage.saveBackground',
      })
      errorSnackbar('Could not save your answer. Please try again.')
    }
    setSavingBackground(false)
    return ok
  }

  const [issues, setIssues] = useState<WebsiteIssue[]>(initialIssues)
  const [savedIssues, setSavedIssues] = useState<WebsiteIssue[]>(initialIssues)
  const [savingIssues, setSavingIssues] = useState(false)
  const issuesDirty = JSON.stringify(issues) !== JSON.stringify(savedIssues)
  const saveIssues = async (): Promise<boolean> => {
    if (savingIssues || !issuesDirty) return true
    setSavingIssues(true)
    const ok = await saveAboutFields({ issues })
    if (ok) {
      setSavedIssues(issues)
      void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } else {
      errorSnackbar('Could not save your issues. Please try again.')
    }
    setSavingIssues(false)
    return ok
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
  // Stop on the first failure so a failed field doesn't leave a partial save
  // (the still-dirty fields stay dirty for the user to retry).
  const saveAll = async (): Promise<void> => {
    if (anySaving || !anyDirty) return
    if (!(await saveWhy())) return
    if (!(await saveBackground())) return
    await saveIssues()
  }

  // Bumped by "Start over" to remount the why/background cards so their
  // in-card rewrite state (a lingering "Undo", an in-flight suggestion) resets
  // with the cleared fields. (The issues card empties itself — 0 rows — so its
  // rows unmount on their own.)
  const [resetKey, setResetKey] = useState(0)

  // Clears the fields in memory only; nothing is deleted until the candidate
  // Saves (the empty state), matching the explicit-save model.
  const startOver = (): void => {
    setWhy('')
    setBackground('')
    setIssues([])
    setResetKey((k) => k + 1)
  }

  return (
    <>
      {/* Scaled to the title bar's fixed height (h-14): a small button clears
          the 56px bar without growing it. */}
      <DashboardNavHeaderAction>
        <Button
          size="small"
          icon={<CheckIcon />}
          loading={anySaving}
          loadingText="Saving…"
          disabled={!anyDirty || anySaving}
          onClick={() => void saveAll()}
        >
          Save
        </Button>
      </DashboardNavHeaderAction>

      <StoryBody>
        <p className="text-base text-muted-foreground">
          The foundation we build everything else on: your why, your background,
          and the issues you&apos;ll fight for. Your answers personalize your
          campaign plan, stump speech, and voter messages.
        </p>

        <StoryIntakeCard
          key={`why-${resetKey}`}
          question={STORY_WHY_QUESTION}
          description={CARD_DESCRIPTION}
          examplePlaceholder={WHY_EXAMPLE_PLACEHOLDER}
          value={why}
          onChange={setWhy}
          rewriteField="why"
          analyticsLabel="dashboard_story_why"
        />

        <StoryIntakeCard
          key={`background-${resetKey}`}
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
      </StoryBody>
    </>
  )
}

export default CampaignStoryPage
