'use client'

import type { ReactNode } from 'react'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Textarea,
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
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { PHONE_BANKING_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { ThinkingStream } from '../social/ThinkingStream'
import { Intro } from '../social/Intro'

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

interface ScriptStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  script: string
  onScriptChange: (script: string) => void
  onRegenerate: () => void
  onImprove: () => void
  canImprove: boolean
  isDrafting: boolean
  isDraftError: boolean
  isCustomPurpose: boolean
}

export const ScriptStep = ({
  tone,
  onToneChange,
  script,
  onScriptChange,
  onRegenerate,
  onImprove,
  canImprove,
  isDrafting,
  isDraftError,
  isCustomPurpose,
}: ScriptStepProps) => {
  const dictation = useDictationAppend({
    analyticsLabel: 'outreach-phone-banking-script',
    value: script,
    onChange: onScriptChange,
  })
  const isRecording = dictation.status === 'recording'

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title="What do you want to say?"
        body="Confirm the script. Volunteers will read this on their calls."
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
          <p className="text-sm text-muted-foreground">Your call script</p>
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

        {isDraftError && (
          <Card className="items-start gap-3 border-destructive p-4">
            <p className="text-sm text-foreground">
              We couldn&apos;t draft your script just now. Try again, or write
              your own below.
            </p>
            <Button
              type="button"
              size="small"
              onClick={isCustomPurpose ? onImprove : onRegenerate}
            >
              Try again
            </Button>
          </Card>
        )}

        {isDrafting && !script.trim() ? (
          <ThinkingStream />
        ) : (
          <Card className="gap-3 p-4">
            <Textarea
              value={script}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder="Write your script…"
              aria-label="Call script"
              // Matches the draft/improve endpoint's currentDraft cap (2000),
              // not the higher create-endpoint script cap (5000) — Improve
              // with AI sends the full text as currentDraft, so the textarea
              // must never accept more than that endpoint allows.
              maxLength={PHONE_BANKING_SCRIPT_MAX_LENGTH}
              className="min-h-[140px] resize-none border-0 p-0 focus-visible:ring-0 [field-sizing:content]"
            />
            <div className="border-border -mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t p-2">
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
                aria-label={isRecording ? 'Stop dictation' : 'Dictate script'}
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
        )}
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
