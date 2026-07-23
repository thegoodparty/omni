'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { stripHtml } from 'string-strip-html'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
} from '@styleguide'
import {
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { WHY_RUNNING_PROMPT } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import StoryCardActions from './StoryCardActions'
import { useStoryRewrite } from './useStoryRewrite'

// The "why" is the candidate's website bio (shared with the Pro-upgrade flow),
// so it's a RichEditor whose stored value is Quill HTML — not a plain textarea
// like the story's `background`. The toolbar is hidden so it reads as plain
// text while emitting the same HTML the Pro-upgrade editor reads.
const RichEditor = dynamic(() => import('app/shared/utils/RichEditor'), {
  ssr: false,
  loading: () => (
    <div className="rounded-md border border-input bg-white px-3 py-2 text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
})

const EXAMPLE =
  'I spent fifteen years running the family hardware store on Main Street, and I watched our downtown empty out while the council handed tax breaks to out-of-town developers. The last straw was when they cut funding for the after-school program my own kids relied on. I decided I was done complaining at the kitchen table and ready to do something about it.'

const plainLength = (html: string): number =>
  html ? stripHtml(html).result.trim().length : 0

interface CampaignStoryWhyCardProps {
  initialBio: string
  // Reports the live answered-state (non-empty as the user types) so the page's
  // "generate" footer appears immediately, not only after a save.
  onAnsweredChange?: (answered: boolean) => void
  // Reports whether the persisted (saved) bio is non-empty. Distinct from
  // onAnsweredChange (live typing): onboarding uses this to reveal the next
  // question only once this one is actually saved.
  onSavedChange?: (saved: boolean) => void
}

const CampaignStoryWhyCard = ({
  initialBio,
  onAnsweredChange,
  onSavedChange,
}: CampaignStoryWhyCardProps): React.JSX.Element => {
  const queryClient = useQueryClient()
  const [bio, setBio] = useState(initialBio)
  const [bioPlainLength, setBioPlainLength] = useState(() =>
    plainLength(initialBio),
  )
  // Drives RichEditor's `initialText`. Stable while typing (changing it re-pastes
  // and would clobber in-progress edits); bumped only on accept/dictation so the
  // new text replaces the editor contents.
  const [editorSeed, setEditorSeed] = useState(initialBio)
  // Refs mirror the latest and last-persisted HTML so the async save reads them
  // without stale closures.
  const valueRef = useRef(bio)
  const savedRef = useRef(bio)
  const savingRef = useRef(false)
  const [savedValue, setSavedValue] = useState(initialBio)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  // Warn before unload if the latest text hasn't been persisted (saves are
  // triggered on blur, which a refresh/navigation can skip).
  useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent): void => {
      if (valueRef.current !== savedRef.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warnIfUnsaved)
    return () => window.removeEventListener('beforeunload', warnIfUnsaved)
  }, [])

  const isDirty = bio !== savedValue

  // Report the saved (persisted) state so onboarding can reveal the next
  // question once this one is saved, not merely typed.
  useEffect(() => {
    onSavedChange?.(plainLength(savedValue) > 0)
  }, [savedValue, onSavedChange])

  // Persists the bio to the website (shared with Pro-upgrade); saveAboutFields
  // creates the site on first write and serializes overlapping saves. The loop
  // flushes edits that arrived mid-flight so a quick reblur can't drop them.
  const save = async (): Promise<void> => {
    if (savingRef.current) return
    if (valueRef.current === savedRef.current) {
      setSaveFailed(false)
      return
    }
    savingRef.current = true
    setIsSaving(true)
    let lastAttempted = savedRef.current
    try {
      while (valueRef.current !== savedRef.current) {
        lastAttempted = valueRef.current
        const ok = await saveAboutFields({ bio: lastAttempted })
        if (!ok) throw new Error('saveAboutFields returned false')
        savedRef.current = lastAttempted
        setSavedValue(lastAttempted)
      }
      setSaveFailed(false)
      // Refresh the shared website cache the plan-tab gate reads, so a freshly
      // saved why isn't hidden by a stale within-staleTime snapshot.
      void queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } catch {
      setSaveFailed(true)
    } finally {
      savingRef.current = false
      setIsSaving(false)
      if (
        valueRef.current !== savedRef.current &&
        valueRef.current !== lastAttempted
      ) {
        setSaveFailed(false)
        void save()
      }
    }
  }

  // RichEditor reports text-change (flag undefined) and blur (flag === 1); save
  // on blur, mirroring the textarea card's autosave.
  const handleChange = (value: string, flag?: number): void => {
    valueRef.current = value
    setBio(value)
    if (flag === 1) void save()
  }

  const handleLength = (length: number): void => {
    setBioPlainLength(length)
    onAnsweredChange?.(length > 0)
  }

  // Replaces the editor contents with plain text (from a rewrite or dictation)
  // by re-seeding it; the editor then re-emits the HTML via handleChange. The
  // toolbar is hidden, so storing plain text is fine (it round-trips as HTML).
  const applyText = (text: string): void => {
    valueRef.current = text
    setBio(text)
    setEditorSeed(text)
    setBioPlainLength(text.trim().length)
    onAnsweredChange?.(text.trim().length > 0)
  }

  // Applies AI-improved text (or the pre-improvement text on undo) by re-seeding
  // the editor and persisting now — there may be no blur to trigger the autosave.
  const applyRewrite = (text: string): void => {
    applyText(text)
    void save()
  }

  const plainBio = bio ? stripHtml(bio).result : ''

  const rewrite = useStoryRewrite('why', plainBio.trim(), applyRewrite)

  // Voice capture appends the transcript into the editor via applyText; the
  // candidate reviews and saves (a save button appears once dirty).
  const dictation = useDictationAppend({
    analyticsLabel: 'campaign_story_why',
    value: plainBio,
    onChange: applyText,
  })

  return (
    <Card className="p-6" data-testid="campaign-story-card-why">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-foreground">Your why</h3>
        <p className="text-sm text-muted-foreground">{WHY_RUNNING_PROMPT}</p>
      </div>

      <div className="flex flex-col gap-4">
        <RichEditor
          initialText={editorSeed}
          onChangeCallback={handleChange}
          onTextLengthChange={handleLength}
          hideToolbar
        />

        {saveFailed && (
          <p className="text-sm text-destructive">
            Couldn&apos;t save your answer.{' '}
            <Button
              variant="link"
              size="small"
              className="h-auto p-0"
              onClick={save}
            >
              Retry
            </Button>
          </p>
        )}

        {rewrite.limitReached && (
          <p className="text-sm text-muted-foreground">
            You&apos;ve reached your AI rewrite limit for this campaign. You can
            still edit your answers yourself.
          </p>
        )}

        {rewrite.rewriteError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t generate a rewrite.{' '}
            <Button
              variant="link"
              size="small"
              className="h-auto p-0"
              onClick={() => void rewrite.requestRewrite()}
            >
              Try again
            </Button>
          </p>
        )}

        <StoryCardActions
          isDirty={isDirty}
          hasSavedContent={plainLength(savedValue) > 0}
          isSaving={isSaving}
          onSave={save}
          rewrite={rewrite}
          improveDisabled={bioPlainLength === 0}
          dictation={dictation}
        />

        <Accordion type="single" collapsible size="sm" className="-mt-2">
          <AccordionItem value="example">
            <AccordionTrigger>Here&apos;s an example</AccordionTrigger>
            <AccordionContent>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {EXAMPLE}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </Card>
  )
}

export default CampaignStoryWhyCard
