'use client'

import type { ReactNode } from 'react'
import {
  CONSTITUENT_NAME_TOKEN,
  PHONE_BANKING_INSTRUCTIONS_MAX_LENGTH,
  PHONE_BANKING_NAME_MAX_LENGTH,
  PHONE_BANKING_SCRIPT_MAX_LENGTH,
  SOCIAL_TONE_VALUES,
  type SocialTone,
  VOTER_NAME_TOKEN,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Input,
  Label,
  TokenField,
  type TokenSpec,
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
import { Intro } from '../social/Intro'

const INSTRUCTIONS_PLACEHOLDER =
  'Optional: tell the AI what to change (e.g. mention the school levy, ' +
  'keep it under a minute)'

// The contact's name, which the caller page fills in for each call. A pill,
// because what the volunteer reads differs from what the script holds. Keyed
// by surface: an elected official's script never says "voter".
const CONTACT_NAME_TOKEN: Record<'win' | 'serve', TokenSpec> = {
  win: { id: 'contact_name', label: 'Voter name', text: VOTER_NAME_TOKEN },
  serve: {
    id: 'contact_name',
    label: 'Constituent name',
    text: CONSTITUENT_NAME_TOKEN,
  },
}

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
  isServe: boolean
  name: string
  onNameChange: (name: string) => void
  audienceLabel: string
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  script: string
  onScriptChange: (script: string) => void
  instructions: string
  onInstructionsChange: (instructions: string) => void
  onRegenerate: () => void
  onImprove: () => void
  // Repeats the call that failed, Regenerate or Improve.
  onRetry: () => void
  canImprove: boolean
  isDrafting: boolean
  isDraftError: boolean
  isCustomPurpose: boolean
}

export const ScriptStep = ({
  isServe,
  name,
  onNameChange,
  audienceLabel,
  tone,
  onToneChange,
  script,
  onScriptChange,
  instructions,
  onInstructionsChange,
  onRegenerate,
  onImprove,
  onRetry,
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
  const captionText = isCustomPurpose
    ? 'Your call script'
    : `Suggested for ${audienceLabel}`

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title="Write your call script"
        body="This is the script your volunteers will read on the phone. Edit it to sound like you."
      />

      <div className="space-y-2">
        <Label htmlFor="phone-banking-campaign-name">Campaign name</Label>
        <Input
          id="phone-banking-campaign-name"
          value={name}
          maxLength={PHONE_BANKING_NAME_MAX_LENGTH}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Name this campaign"
        />
        <p className="text-sm text-muted-foreground">
          Internal name to identify this campaign in your history.
        </p>
      </div>

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
          <p className="text-sm text-muted-foreground">{captionText}</p>
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

        <Input
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          maxLength={PHONE_BANKING_INSTRUCTIONS_MAX_LENGTH}
          placeholder={INSTRUCTIONS_PLACEHOLDER}
          aria-label="Instructions for the AI"
        />

        {isDraftError && (
          <Card className="items-start gap-3 border-destructive p-4">
            <p className="text-sm text-foreground">
              We couldn&apos;t draft your script just now. Try again, or write
              your own below.
            </p>
            <Button type="button" size="small" onClick={onRetry}>
              Try again
            </Button>
          </Card>
        )}

        <Card className="gap-3 p-4">
          <TokenField
            value={script}
            onChange={onScriptChange}
            tokens={[CONTACT_NAME_TOKEN[isServe ? 'serve' : 'win']]}
            // Read-only until the first draft lands, so nothing typed is
            // overwritten by it.
            readOnly={isDrafting && !script.trim()}
            placeholder={
              isDrafting && !script.trim()
                ? 'Drafting your script…'
                : 'Write your script…'
            }
            aria-label="Call script"
            // Matches the draft/improve endpoint's currentDraft cap (2000),
            // not the higher create-endpoint script cap (5000) — Improve
            // with AI sends the full text as currentDraft, so the field
            // must never accept more than that endpoint allows.
            maxLength={PHONE_BANKING_SCRIPT_MAX_LENGTH}
            variant="seamless"
            className="min-h-[140px]"
          />
          <LengthCounter
            length={script.length}
            max={PHONE_BANKING_SCRIPT_MAX_LENGTH}
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
