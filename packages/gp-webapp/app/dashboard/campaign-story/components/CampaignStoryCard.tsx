'use client'

import { useEffect, useRef, useState } from 'react'
import type { CampaignStory } from '@goodparty_org/contracts'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  Textarea,
} from '@styleguide'
import { reportErrorToSentry } from '@shared/sentry'
import { clientRequest } from 'gpApi/typed-request'
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import RewriteSuggestion from './RewriteSuggestion'
import StoryCardActions from './StoryCardActions'
import { useStoryRewrite } from './useStoryRewrite'

export type CampaignStoryField = keyof CampaignStory

export interface CampaignStorySection {
  id: CampaignStoryField
  title: string
  description: string
  placeholder: string
  // Default example shown in the "Here's an example" accordion. Placeholder
  // copy until Terry supplies the "gold" examples — swap the text in sections.ts.
  example: string
}

interface CampaignStoryCardProps {
  section: CampaignStorySection
  initialValue: string | null
  // Reports this field's live answered-state (non-empty as the user types) so
  // the page's "generate" footer appears immediately, not only after blur/save.
  onAnsweredChange?: (answered: boolean) => void
  // Reports whether the persisted (saved) value is non-empty. Onboarding uses
  // this to reveal the next question only once this one is saved.
  onSavedChange?: (saved: boolean) => void
}

const CampaignStoryCard = ({
  section,
  initialValue,
  onAnsweredChange,
  onSavedChange,
}: CampaignStoryCardProps): React.JSX.Element => {
  const { id, title, description, placeholder, example } = section
  const [value, setValue] = useState(initialValue ?? '')
  // Refs mirror the latest value and the last-persisted value so the async
  // save can read them without stale closures.
  const valueRef = useRef(value)
  const savedRef = useRef(value)
  const savingRef = useRef(false)
  const [saveFailed, setSaveFailed] = useState(false)
  // Reactive mirrors of the save lifecycle so the explicit Save button can show
  // dirty / saving / saved state (the refs above drive the async save itself).
  const [savedValue, setSavedValue] = useState(initialValue ?? '')
  const [isSaving, setIsSaving] = useState(false)

  // Safety net for the navigate-away/refresh case: the only save trigger is
  // blur, so warn before unload if the latest text hasn't been persisted.
  useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent): void => {
      if (valueRef.current !== savedRef.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warnIfUnsaved)
    return () => window.removeEventListener('beforeunload', warnIfUnsaved)
  }, [])

  const isDirty = value !== savedValue

  // Report the saved (persisted) state so onboarding can reveal the next
  // question once this one is saved, not merely typed.
  useEffect(() => {
    onSavedChange?.(savedValue.trim().length > 0)
  }, [savedValue, onSavedChange])

  // One place to update the field, used by typing, dictation, and accepting a
  // rewrite, so the ref + answered-state stay in sync however text arrives.
  const applyValue = (next: string): void => {
    valueRef.current = next
    setValue(next)
    onAnsweredChange?.(next.trim().length > 0)
  }

  const handleChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ): void => {
    applyValue(event.target.value)
  }

  // Autosave on blur. The loop flushes any edits that arrived while a request
  // was in flight, so a quick refocus-edit-reblur can't drop the newer text.
  const save = async (): Promise<void> => {
    if (savingRef.current) return
    // Nothing to persist (e.g. the user reverted a failed edit back to the
    // saved text) — clear any stale error so the banner doesn't linger.
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
        await clientRequest('PUT /v1/campaigns/mine/story', {
          background: lastAttempted,
        })
        savedRef.current = lastAttempted
        setSavedValue(lastAttempted)
      }
      setSaveFailed(false)
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'CampaignStoryCard.save',
        field: id,
      })
      setSaveFailed(true)
    } finally {
      savingRef.current = false
      setIsSaving(false)
      // If the user edited again while a *failed* save was in flight, flush
      // that newer text once. Guarded on the value differing from what we just
      // tried, so a persistent failure with no new input falls back to the
      // Retry button instead of looping.
      if (
        valueRef.current !== savedRef.current &&
        valueRef.current !== lastAttempted
      ) {
        // Hide the stale error banner while the auto-flush is in flight, so a
        // Retry click can't be silently dropped by the savingRef guard. If the
        // flush also fails, the catch re-sets it.
        setSaveFailed(false)
        void save()
      }
    }
  }

  // "Use this" replaces the field with the suggestion and persists it now,
  // rather than waiting for a blur — the user accepted via a button click, so
  // there may be no blur to trigger the autosave.
  const acceptRewrite = (text: string): void => {
    applyValue(text)
    void save()
  }

  const rewrite = useStoryRewrite(id, value, acceptRewrite)

  // Voice capture appends the transcript into the field via applyValue; the
  // candidate then reviews and saves (a save button appears once dirty).
  const dictation = useDictationAppend({
    analyticsLabel: `campaign_story_${id}`,
    value,
    onChange: applyValue,
  })

  return (
    <Card className="p-6" data-testid={`campaign-story-card-${id}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-col gap-4">
        <Textarea
          value={value}
          onChange={handleChange}
          onBlur={save}
          placeholder={placeholder}
          className="min-h-28"
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

        {rewrite.rewriteActive && <RewriteSuggestion rewrite={rewrite} />}

        <StoryCardActions
          isDirty={isDirty}
          hasSavedContent={savedValue.trim().length > 0}
          isSaving={isSaving}
          onSave={save}
          rewrite={rewrite}
          improveDisabled={value.trim().length === 0}
          dictation={dictation}
        />

        <Accordion type="single" collapsible size="sm" className="-mt-2">
          <AccordionItem value="example">
            <AccordionTrigger>Here&apos;s an example</AccordionTrigger>
            <AccordionContent>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {example}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </Card>
  )
}

export default CampaignStoryCard
