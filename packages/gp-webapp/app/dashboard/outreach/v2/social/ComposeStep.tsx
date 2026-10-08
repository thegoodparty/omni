'use client'

import type { ReactNode } from 'react'
import {
  SOCIAL_DRAFT_MESSAGE_MAX_LENGTH,
  SOCIAL_TONE_VALUES,
  type SocialTone,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  TokenField,
} from '@styleguide'
import {
  ClockIcon,
  Loader2Icon,
  MicIcon,
  RefreshIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
} from '@styleguide/components/ui/icons'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { Intro } from './Intro'

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

const TONE_ICONS: Record<SocialTone, ReactNode> = {
  warm: <SunIcon className="size-4" />,
  direct: <TargetIcon className="size-4" />,
  urgent: <ClockIcon className="size-4" />,
  friendly: <SmileIcon className="size-4" />,
}

interface ComposeStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  draft: string
  onDraftChange: (draft: string) => void
  onRegenerate: () => void
  // Polishes the user's own words in place — available for every purpose,
  // including custom (the custom guard only blocks fresh generation).
  onImprove: () => void
  // Repeats the call that failed, Regenerate or Improve.
  onRetry: () => void
  // Improve appears only once the user has typed/dictated something —
  // never from tone-preset-only interaction (same precursor state as Undo).
  canImprove: boolean
  isDrafting: boolean
  isDraftError: boolean
  // Undo appears only once a generated draft (Regenerate / tone switch /
  // Improve) has replaced manually typed text — never from tone-preset-only
  // interaction.
  canUndo: boolean
  onUndo: () => void
  isCustomPurpose: boolean
}

export const ComposeStep = ({
  tone,
  onToneChange,
  draft,
  onDraftChange,
  onRegenerate,
  onImprove,
  onRetry,
  canImprove,
  isDrafting,
  isDraftError,
  canUndo,
  onUndo,
  isCustomPurpose,
}: ComposeStepProps) => {
  const dictation = useDictationAppend({
    analyticsLabel: 'outreach-social-compose',
    value: draft,
    onChange: onDraftChange,
  })
  const isRecording = dictation.status === 'recording'

  return (
    <div className="space-y-6">
      <Intro
        channel="socialMedia"
        title="What do you want to say?"
        body="Confirm the message. We'll adapt this draft to each platform's voice and length in the next steps."
      />

      <FilterPillGroup
        type="single"
        value={tone}
        onValueChange={(value) => value && onToneChange(value as SocialTone)}
      >
        {SOCIAL_TONE_VALUES.map((t) => (
          <FilterPill key={t} value={t} className="gap-1.5">
            {TONE_ICONS[t]}
            {TONE_LABELS[t]}
          </FilterPill>
        ))}
      </FilterPillGroup>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Your draft message</p>
          <div className="flex items-center gap-2">
            {!isCustomPurpose && (
              <Button
                type="button"
                variant="link"
                size="small"
                className="h-auto gap-1.5 px-0 no-underline"
                disabled={isDrafting}
                onClick={onRegenerate}
              >
                {isDrafting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <RefreshIcon className="size-4" />
                )}
                Regenerate
              </Button>
            )}
          </div>
        </div>

        {isDraftError && (
          <Card className="items-start gap-3 border-destructive p-4">
            <p className="text-sm text-foreground">
              We couldn&apos;t draft your message just now. Try again, or write
              your own below.
            </p>
            <Button type="button" size="small" onClick={onRetry}>
              Try again
            </Button>
          </Card>
        )}

        <Card className="gap-3 p-4">
          <TokenField
            value={draft}
            onChange={onDraftChange}
            // Read-only until the first draft lands, so nothing typed is
            // overwritten by it.
            readOnly={isDrafting && !draft.trim()}
            placeholder={
              isDrafting && !draft.trim()
                ? 'Drafting your message…'
                : 'Write your message…'
            }
            aria-label="Draft message"
            maxLength={SOCIAL_DRAFT_MESSAGE_MAX_LENGTH}
            variant="seamless"
            className="min-h-[140px]"
          />
          <LengthCounter
            length={draft.length}
            max={SOCIAL_DRAFT_MESSAGE_MAX_LENGTH}
          />
          <div className="border-border -mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t p-2">
            {canUndo && (
              <Button
                type="button"
                variant="link"
                size="small"
                className="h-auto px-2"
                onClick={onUndo}
              >
                Undo
              </Button>
            )}
            {canImprove && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                className="text-muted-foreground"
                disabled={isDrafting}
                onClick={onImprove}
              >
                {isDrafting ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Improving…
                  </>
                ) : (
                  <>
                    <SparklesIcon className="size-4" />
                    Improve with AI
                  </>
                )}
              </Button>
            )}
            <IconButton
              type="button"
              variant={isRecording ? 'destructive' : 'ghost'}
              size="small"
              aria-label={isRecording ? 'Stop dictation' : 'Dictate message'}
              disabled={isDrafting || dictation.status === 'stopping'}
              onClick={() => {
                void dictation.toggle()
              }}
              className={cn(!isRecording && 'text-muted-foreground')}
            >
              {dictation.busy && !isRecording ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : isRecording ? (
                <SquareIcon className="size-4 fill-current" aria-hidden />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </IconButton>
          </div>
        </Card>
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
      </div>
    </div>
  )
}
