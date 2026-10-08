'use client'

import { useCallback, useRef } from 'react'
import {
  DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH,
  DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  IconButton,
  Input,
  TokenField,
  type TokenFieldRef,
} from '@styleguide'
import {
  Loader2Icon,
  MicIcon,
  RefreshIcon,
  SparklesIcon,
  SquareIcon,
} from '@styleguide/components/ui/icons'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'
import {
  type DictationStatus,
  useDictation,
} from 'app/dashboard/shared/dictation/useDictation'
import { DEPARTURE_NOTE } from '../talkingPointsCard'

const INSTRUCTIONS_PLACEHOLDER =
  'Optional: tell the AI what to change (e.g. lead with the library, ' +
  'mention the school levy)'

// An unfilled logistics bracket. The prompt allows these for event
// date/time/location, the things this product does not model, so the step
// surfaces them rather than letting a canvasser find "[date]" at a door.
// Deliberately not blocking: a walk with no event has no bracket, and a
// candidate who wants to fill it in on paper is entitled to.
// No `g` flag: a global regex carries `lastIndex` between `.test()` calls, and
// this one is called on every render.
const BRACKET_PATTERN = /\[[^\]]+\]/

export const hasUnfilledBracket = (text: string): boolean =>
  BRACKET_PATTERN.test(text)

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'connecting',
  'recording',
  'stopping',
])

interface TalkingPointsStepProps {
  // Serve has no campaign for the card to be built from: the generation
  // service grounds it in the official's own materials (SERVE_NOUNS), and
  // this caption names the same source the script was actually drafted from.
  isServe: boolean
  // The composed identity clause, shown but not editable: it is rebuilt for
  // whoever reads the card, so a volunteer sees their own version.
  intro: string
  audienceLabel: string
  text: string
  onTextChange: (text: string) => void
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

// A read-only section: composed from campaign records, shown so the candidate
// reviews the whole card rather than only the part they write.
const ComposedSection = ({
  label,
  caption,
  body,
}: {
  label: string
  caption: string
  body: string
}) => (
  <div className="space-y-1">
    <p className="text-sm font-medium text-foreground">{label}</p>
    <p className="text-base text-foreground">{body}</p>
    <p className="text-xs text-muted-foreground">{caption}</p>
  </div>
)

export const TalkingPointsStep = ({
  isServe,
  intro,
  audienceLabel,
  text,
  onTextChange,
  instructions,
  onInstructionsChange,
  onRegenerate,
  onImprove,
  onRetry,
  canImprove,
  isDrafting,
  isDraftError,
  isCustomPurpose,
}: TalkingPointsStepProps) => {
  const fieldRef = useRef<TokenFieldRef>(null)
  // At the cursor rather than appended, so a spoken line lands in the bullet
  // the candidate is on.
  const dictation = useDictation({
    analyticsLabel: 'door-knocking-talking-points',
    onFinalTranscript: (transcript) => {
      if (transcript) fieldRef.current?.insertText(` ${transcript}`)
    },
  })
  const isRecording = dictation.status === 'recording'
  const dictationBusy = ACTIVE_DICTATION.has(dictation.status) && !isRecording
  const toggleDictation = useCallback(async () => {
    if (ACTIVE_DICTATION.has(dictation.status)) await dictation.stop()
    else await dictation.start()
  }, [dictation])
  // Read-only until the first draft lands, so nothing typed is overwritten
  // by it.
  const awaitingFirstDraft = isDrafting && text.trim().length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isCustomPurpose
            ? 'Your talking points'
            : `Written for ${audienceLabel}`}
        </p>
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
        maxLength={DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH}
        placeholder={INSTRUCTIONS_PLACEHOLDER}
        aria-label="Instructions for the AI"
      />

      {isDraftError && (
        <Card className="items-start gap-3 border-destructive p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t write your talking points just now. Try again, or
            write your own below.
          </p>
          <Button type="button" size="small" onClick={onRetry}>
            Try again
          </Button>
        </Card>
      )}

      <Card className="gap-5 p-4">
        {intro && (
          <ComposedSection
            label="Introduction"
            caption={
              isServe
                ? "Built from your own materials. A volunteer's card names you instead."
                : "Built from your campaign. A volunteer's card names you instead."
            }
            body={intro}
          />
        )}

        <div className="space-y-1">
          <TokenField
            ref={fieldRef}
            aria-label="Talking points"
            value={text}
            onChange={onTextChange}
            readOnly={awaitingFirstDraft}
            placeholder={
              awaitingFirstDraft ? 'Drafting…' : 'Write your talking points…'
            }
            maxLength={DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH}
            variant="seamless"
            className="min-h-[140px]"
          />
          <LengthCounter
            length={text.length}
            max={DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH}
          />
          {/* Not on "Something else", which never drafts. */}
          {!isCustomPurpose && (
            <p className="text-xs text-muted-foreground">
              We&apos;ll draft a few bullets to start, and you can rewrite them
              any way you like.
            </p>
          )}
        </div>

        <ComposedSection
          label="Thanks and goodbye"
          caption="The same however the conversation went."
          body={DEPARTURE_NOTE}
        />

        <div className="border-border -mx-4 -mb-4 mt-1 flex items-center justify-end gap-1 border-t p-2">
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
            aria-label={
              isRecording ? 'Stop dictation' : 'Dictate talking points'
            }
            disabled={isDrafting || dictation.status === 'stopping'}
            onClick={() => {
              void toggleDictation()
            }}
            className={cn(!isRecording && 'text-muted-foreground')}
          >
            {dictationBusy ? (
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
          Dictation didn&apos;t start: {dictation.error}. Check your microphone
          permission and try again.
        </p>
      )}

      {hasUnfilledBracket(text) && (
        <p className="text-sm text-foreground">
          Fill in the square brackets before you walk, so nobody reads
          &ldquo;[date]&rdquo; at a door.
        </p>
      )}
    </div>
  )
}
