'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import { useRouter } from 'next/navigation'
import { Card, ChevronLeftIcon, IconButton } from '@styleguide'
import AlertDialog from '@shared/utils/AlertDialog'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { WebsiteIssue } from 'helpers/types'
import {
  getUserWebsite,
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/(dashboard)/website/util/website.util'
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

// The "Your story" page: a full page of its own, with no sidebar, opened from
// the Game Plan's story card. Reuses the onboarding story cards
// (StoryIntakeCard for why/background, StoryIssuesCard for the policy
// priorities). Unlike onboarding, it's a single editable page that saves as
// the candidate goes: each field saves itself a moment after they stop typing.
const CampaignStoryPage = (): React.JSX.Element => (
  <main className="min-h-screen bg-sidebar">
    <StoryEditor />
  </main>
)

// Back returns to wherever the candidate came from (usually the Game Plan),
// and to the Game Plan when the page was opened directly. It saves whatever
// is still waiting first, so leaving mid-sentence keeps the sentence.
const StoryHeader = ({
  status,
  beforeLeave,
}: {
  status?: string | null
  beforeLeave?: () => Promise<void>
}): React.JSX.Element => {
  const router = useRouter()
  const goBack = async (): Promise<void> => {
    await beforeLeave?.()
    if (window.history.length > 1) router.back()
    else router.push('/campaign-plan')
  }
  return (
    <header className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 pt-6 sm:px-8 sm:pt-10">
      <IconButton
        type="button"
        variant="ghost"
        size="small"
        className="-ml-2 size-10"
        aria-label="Back"
        onClick={() => void goBack()}
      >
        <ChevronLeftIcon className="size-5" aria-hidden />
      </IconButton>
      <h1 className="text-2xl font-semibold text-foreground">Your story</h1>
      <p
        className="ml-auto text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </header>
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
        <StoryHeader />
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
        <StoryHeader />
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

const AUTOSAVE_DELAY_MS = 1000

// Saves one field a moment after its value stops changing. A save that fails
// is not retried until the value changes again, so a dropped connection
// doesn't loop on an error. `save` is read at fire time, so it always writes
// the latest value.
const useAutosave = <T,>(
  value: T,
  isDirty: boolean,
  isSaving: boolean,
  save: () => Promise<boolean>,
): { failed: boolean } => {
  const saveRef = useRef(save)
  saveRef.current = save
  const [failedValue, setFailedValue] = useState<string | null>(null)
  const key = JSON.stringify(value)
  const failed = isDirty && failedValue === key

  useEffect(() => {
    if (!isDirty || isSaving || failedValue === key) return
    const timer = setTimeout(() => {
      void saveRef.current().then((ok) => setFailedValue(ok ? null : key))
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, isDirty, isSaving, failedValue])

  return { failed }
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

  const whyAutosave = useAutosave(why, why !== savedWhy, savingWhy, saveWhy)
  const backgroundAutosave = useAutosave(
    background,
    background !== savedBackground,
    savingBackground,
    saveBackground,
  )
  const issuesAutosave = useAutosave(
    issues,
    issuesDirty,
    savingIssues,
    saveIssues,
  )

  const anySaving = savingWhy || savingBackground || savingIssues
  const anyDirty =
    why !== savedWhy || background !== savedBackground || issuesDirty
  const anyFailed =
    whyAutosave.failed || backgroundAutosave.failed || issuesAutosave.failed
  // Becomes true after the first save lands, so a page opened and left alone
  // never claims to have saved anything.
  const [hasSaved, setHasSaved] = useState(false)
  const wasBusy = useRef(false)
  useEffect(() => {
    const busy = anySaving || anyDirty
    if (wasBusy.current && !busy) setHasSaved(true)
    wasBusy.current = busy
  }, [anySaving, anyDirty])
  const status = anyFailed
    ? 'Not saved'
    : anySaving || anyDirty
      ? 'Saving…'
      : hasSaved
        ? 'Saved'
        : null
  // Drives the "Start over" affordance: only offered once the candidate has
  // entered something to clear.
  const anyContent =
    why.trim().length > 0 || background.trim().length > 0 || issues.length > 0

  // Writes everything still waiting on its autosave, for when the candidate
  // leaves. Each save* is a no-op when its field is unchanged. Stop on the
  // first failure so a failed field doesn't leave a partial save.
  const saveAll = async (): Promise<void> => {
    if (!anyDirty) return
    if (!(await saveWhy())) return
    if (!(await saveBackground())) return
    await saveIssues()
  }

  // Bumped by "Start over" to remount the why/background cards so their
  // in-card rewrite state (a lingering "Undo", an in-flight suggestion) resets
  // with the cleared fields. (The issues card empties itself — 0 rows — so its
  // rows unmount on their own.)
  const [resetKey, setResetKey] = useState(0)

  // Autosave persists the cleared fields, so clearing asks first.
  const [confirmingStartOver, setConfirmingStartOver] = useState(false)
  const startOver = (): void => {
    setConfirmingStartOver(false)
    setWhy('')
    setBackground('')
    setIssues([])
    setResetKey((k) => k + 1)
  }

  return (
    <>
      <StoryHeader status={status} beforeLeave={saveAll} />

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
              onClick={() => setConfirmingStartOver(true)}
              className="rounded-full px-4 py-2 text-base font-medium text-link transition-colors hover:bg-link/10"
            >
              Start over
            </button>
          </div>
        )}
      </StoryBody>

      <AlertDialog
        open={confirmingStartOver}
        title="Start over?"
        description="This clears your why, your background, and your issues."
        cancelLabel="Keep my story"
        proceedLabel="Start over"
        handleClose={() => setConfirmingStartOver(false)}
        handleProceed={startOver}
      />
    </>
  )
}

export default CampaignStoryPage
