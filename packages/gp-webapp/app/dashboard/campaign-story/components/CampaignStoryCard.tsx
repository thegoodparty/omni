'use client'

import { useEffect, useRef, useState } from 'react'
import type { CampaignStory } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  Textarea,
  CheckIcon,
  SparklesIcon,
  WandSparklesIcon,
  XMarkIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'

export type CampaignStoryField = keyof CampaignStory

export interface CampaignStorySection {
  id: CampaignStoryField
  title: string
  description: string
  placeholder: string
}

const EMPTY_HINT = 'Not answered yet. Even two sentences here unlocks a lot.'
const STARTED_HINT =
  'Worth saying more: another 1-2 sentences will sharpen this a lot.'
const ENOUGH_HINT = "That's great! The more you give us, the better!"

// The counter denominator and the point where the nudge turns into positive
// reinforcement. A suggestion shown to the writer, NOT an input cap — typing
// past it is allowed (the textarea has no maxLength).
const SUGGESTED_CHARS = 100

interface CampaignStoryCardProps {
  section: CampaignStorySection
  initialValue: string | null
  // Reports this field's live answered-state (non-empty as the user types) so
  // the page's "generate" footer appears immediately, not only after blur/save.
  onAnsweredChange?: (answered: boolean) => void
}

const CampaignStoryCard = ({
  section,
  initialValue,
  onAnsweredChange,
}: CampaignStoryCardProps): React.JSX.Element => {
  const { id, title, description, placeholder } = section
  const [value, setValue] = useState(initialValue ?? '')
  // Refs mirror the latest value and the last-persisted value so the async
  // save can read them without stale closures.
  const valueRef = useRef(value)
  const savedRef = useRef(value)
  const savingRef = useRef(false)
  const [saveFailed, setSaveFailed] = useState(false)

  // AI "Help me rewrite" suggestion. `rewrite` holds the latest draft; the
  // card is shown whenever we're generating, have a draft, or hit an error.
  const [rewrite, setRewrite] = useState<string | null>(null)
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState(false)
  // Guards against overlapping rewrite calls (e.g. a double-click landing
  // before the disabled state re-renders), so an older response can't resolve
  // after a newer one and show a stale suggestion.
  const rewritingRef = useRef(false)
  const rewriteActive = isRewriting || rewrite !== null || rewriteError

  // Safety net for the navigate-away/refresh case: the only save trigger is
  // blur, so warn before unload if the latest text hasn't been persisted.
  useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent): void => {
      if (valueRef.current !== savedRef.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warnIfUnsaved)
    return () => window.removeEventListener('beforeunload', warnIfUnsaved)
  }, [])

  const trimmedLength = value.trim().length
  const hint =
    trimmedLength === 0
      ? EMPTY_HINT
      : trimmedLength < SUGGESTED_CHARS
        ? STARTED_HINT
        : ENOUGH_HINT

  const handleChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ): void => {
    valueRef.current = event.target.value
    setValue(event.target.value)
    onAnsweredChange?.(event.target.value.trim().length > 0)
  }

  // Autosave on blur. The loop flushes any edits that arrived while a request
  // was in flight, so a quick refocus-edit-reblur can't drop the newer text.
  // `id` is `keyof CampaignStory`, so the computed-key payload is a valid field.
  const save = async (): Promise<void> => {
    if (savingRef.current) return
    // Nothing to persist (e.g. the user reverted a failed edit back to the
    // saved text) — clear any stale error so the banner doesn't linger.
    if (valueRef.current === savedRef.current) {
      setSaveFailed(false)
      return
    }
    savingRef.current = true
    let lastAttempted = savedRef.current
    try {
      while (valueRef.current !== savedRef.current) {
        lastAttempted = valueRef.current
        // Build the single-field body per id so it satisfies the endpoint's
        // "at least one field" union type (a computed-key literal would widen
        // to an index signature and not match).
        const body =
          id === 'why'
            ? { why: lastAttempted }
            : id === 'background'
              ? { background: lastAttempted }
              : { issues: lastAttempted }
        await clientRequest('PUT /v1/campaigns/mine/story', body)
        savedRef.current = lastAttempted
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

  const requestRewrite = async (): Promise<void> => {
    const text = valueRef.current.trim()
    if (!text || rewritingRef.current) return
    rewritingRef.current = true
    setIsRewriting(true)
    setRewriteError(false)
    setRewrite(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/story/rewrite',
        { field: id, text },
      )
      setRewrite(data.rewrite)
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'CampaignStoryCard.rewrite',
        field: id,
      })
      setRewriteError(true)
    } finally {
      rewritingRef.current = false
      setIsRewriting(false)
    }
  }

  const discardRewrite = (): void => {
    setRewrite(null)
    setRewriteError(false)
  }

  // "Use this" replaces the field with the suggestion and persists it now,
  // rather than waiting for a blur — the user accepted via a button click, so
  // there may be no blur to trigger the autosave.
  const acceptRewrite = (text: string): void => {
    valueRef.current = text
    setValue(text)
    onAnsweredChange?.(text.trim().length > 0)
    discardRewrite()
    void save()
  }

  const hintBox = (
    <div className="flex flex-1 items-start gap-2 rounded-lg bg-primary/5 p-3">
      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold uppercase tracking-wide text-primary">
          Campaign Manager
        </span>
        <span className="text-sm text-foreground">{hint}</span>
      </div>
    </div>
  )

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="relative">
          <Textarea
            value={value}
            onChange={handleChange}
            onBlur={save}
            placeholder={placeholder}
            className="min-h-28 pb-7"
          />
          <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-muted-foreground">
            {value.length}/{SUGGESTED_CHARS}
          </span>
        </div>

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

        {rewriteActive ? (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-primary bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
                  <WandSparklesIcon className="size-4" />
                  Suggested rewrite
                </span>
                <span className="text-sm text-muted-foreground">
                  From your Campaign Manager
                </span>
              </div>

              {isRewriting ? (
                <p className="text-sm text-muted-foreground">
                  Your Campaign Manager is writing a draft&hellip;
                </p>
              ) : rewriteError ? (
                <p className="text-sm text-destructive">
                  Couldn&apos;t generate a rewrite. Please try again.
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-base text-foreground">
                  {rewrite}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  icon={<XMarkIcon />}
                  onClick={discardRewrite}
                  disabled={isRewriting}
                >
                  Discard
                </Button>
                <Button
                  variant="outline"
                  icon={<WandSparklesIcon />}
                  onClick={requestRewrite}
                  disabled={isRewriting}
                >
                  Try again
                </Button>
                <Button
                  icon={<CheckIcon />}
                  onClick={() => rewrite && acceptRewrite(rewrite)}
                  disabled={isRewriting || !rewrite}
                >
                  Use this
                </Button>
              </div>
            </div>

            {hintBox}
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {hintBox}

            <Button
              icon={<WandSparklesIcon />}
              className="sm:shrink-0"
              onClick={requestRewrite}
              disabled={trimmedLength === 0}
            >
              Help me rewrite
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

export default CampaignStoryCard
