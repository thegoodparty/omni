'use client'

import { useEffect, useRef, useState } from 'react'
import type { CampaignStory } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  Textarea,
  SparklesIcon,
  WandSparklesIcon,
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
}

const CampaignStoryCard = ({
  section,
  initialValue,
}: CampaignStoryCardProps): React.JSX.Element => {
  const { id, title, description, placeholder } = section
  const [value, setValue] = useState(initialValue ?? '')
  // Refs mirror the latest value and the last-persisted value so the async
  // save can read them without stale closures.
  const valueRef = useRef(value)
  const savedRef = useRef(value)
  const savingRef = useRef(false)
  const [saveFailed, setSaveFailed] = useState(false)

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
    try {
      while (valueRef.current !== savedRef.current) {
        const pending = valueRef.current
        await clientRequest('PUT /v1/campaigns/mine/story', { [id]: pending })
        savedRef.current = pending
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
    }
  }

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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-start gap-2 rounded-lg bg-primary/5 p-3">
            <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold uppercase tracking-wide text-primary">
                Campaign Manager
              </span>
              <span className="text-sm text-foreground">{hint}</span>
            </div>
          </div>

          <Button icon={<WandSparklesIcon />} className="sm:shrink-0">
            Help me rewrite
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default CampaignStoryCard
