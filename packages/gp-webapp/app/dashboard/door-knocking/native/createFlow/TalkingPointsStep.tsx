'use client'

import {
  DOOR_KNOCKING_INSTRUCTIONS_MAX_LENGTH,
  DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH,
} from '@goodparty_org/contracts'
import { Button, Card, cn, IconButton, Input, Textarea } from '@styleguide'
import {
  Loader2Icon,
  MicIcon,
  RefreshIcon,
  SparklesIcon,
  SquareIcon,
} from '@styleguide/components/ui/icons'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { ThinkingStream } from 'app/dashboard/outreach/v2/social/ThinkingStream'
import { DEPARTURE_NOTE, type TalkingPointsLines } from '../talkingPointsCard'

const INSTRUCTIONS_PLACEHOLDER =
  'Optional: tell the AI what to change (e.g. lead with the library, ' +
  'mention the school levy)'

// An unfilled logistics bracket. The prompt allows these in the ask alone,
// for event date/time/location — the things this product does not model — so
// the step surfaces them rather than letting a canvasser find "[date]" at a
// door. Deliberately not blocking: a walk with no event has no bracket, and a
// candidate who wants to fill it in on paper is entitled to.
// No `g` flag: a global regex carries `lastIndex` between `.test()` calls, and
// this one is called on every render.
const BRACKET_PATTERN = /\[[^\]]+\]/

export const hasUnfilledBracket = (lines: TalkingPointsLines): boolean =>
  BRACKET_PATTERN.test(
    [lines.engagementQuestion, lines.context, lines.cta, lines.ask].join(' '),
  )

// The four editable sections, in card order. `generated` marks the three the
// model wrote — the CTA is composed from the campaign's own website, so it is
// editable but never regenerated, and saying so is what stops a candidate
// waiting for Regenerate to rewrite it.
const SECTIONS: {
  key: keyof TalkingPointsLines
  label: string
  caption: string
  placeholder: string
  generated: boolean
}[] = [
  {
    key: 'engagementQuestion',
    label: 'Opening question',
    caption:
      'Follows your introduction, so the door opens into a conversation.',
    placeholder: 'Ask something light that invites an answer…',
    generated: true,
  },
  {
    key: 'context',
    label: 'Context',
    caption: 'Why you, in one idea. The line to put in their own words.',
    placeholder: 'What you would want a neighbour to remember…',
    generated: true,
  },
  {
    key: 'cta',
    label: 'Call to action',
    caption:
      'A next step they can take alone. Taken from your website, not written by AI.',
    placeholder: 'Where they can learn more…',
    generated: false,
  },
  {
    key: 'ask',
    label: 'The ask',
    caption: 'The one commitment worth asking for at this door.',
    placeholder: 'What to ask them for…',
    generated: true,
  },
]

interface TalkingPointsStepProps {
  // The composed identity clause, shown but not editable — it is rebuilt for
  // whoever reads the card, so a volunteer sees their own version.
  intro: string
  audienceLabel: string
  lines: TalkingPointsLines
  onLineChange: (key: keyof TalkingPointsLines, value: string) => void
  instructions: string
  onInstructionsChange: (instructions: string) => void
  onRegenerate: () => void
  onImprove: () => void
  canImprove: boolean
  isDrafting: boolean
  isDraftError: boolean
  isCustomPurpose: boolean
}

// A read-only section: composed from campaign records, shown so the candidate
// reviews the whole card rather than three lines out of five.
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
  intro,
  audienceLabel,
  lines,
  onLineChange,
  instructions,
  onInstructionsChange,
  onRegenerate,
  onImprove,
  canImprove,
  isDrafting,
  isDraftError,
  isCustomPurpose,
}: TalkingPointsStepProps) => {
  // Dictation on the context line only. It is the one section long enough to
  // be worth speaking, and one mic beside four boxes would not say which it
  // was about to append to.
  const dictation = useDictationAppend({
    analyticsLabel: 'door-knocking-talking-points',
    value: lines.context,
    onChange: (value) => onLineChange('context', value),
  })
  const isRecording = dictation.status === 'recording'
  // The GENERATED sections only. The CTA is seeded from the campaign record
  // before the first draft is even requested, so counting it would put the
  // boxes on screen for the whole of that first generation — and anything
  // typed into them in those seconds is silently overwritten when the draft
  // lands.
  const nothingDrafted = SECTIONS.filter(({ generated }) => generated).every(
    ({ key }) => lines[key].trim().length === 0,
  )

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
          <Button
            type="button"
            size="small"
            onClick={isCustomPurpose ? onImprove : onRegenerate}
          >
            Try again
          </Button>
        </Card>
      )}

      {isDrafting && nothingDrafted ? (
        <ThinkingStream />
      ) : (
        <Card className="gap-5 p-4">
          {intro && (
            <ComposedSection
              label="Introduction"
              caption="Built from your campaign. A volunteer's card names you instead."
              body={intro}
            />
          )}

          {SECTIONS.map(({ key, label, caption, placeholder }) => (
            <div key={key} className="space-y-1">
              <label
                htmlFor={`talking-points-${key}`}
                className="text-sm font-medium text-foreground"
              >
                {label}
              </label>
              <Textarea
                id={`talking-points-${key}`}
                value={lines[key]}
                onChange={(e) => onLineChange(key, e.target.value)}
                placeholder={placeholder}
                // The draft endpoint's own per-line cap: Improve with AI sends
                // these back as currentDraft, so the box must never accept
                // more than that endpoint allows.
                maxLength={DOOR_KNOCKING_TALKING_POINT_MAX_LENGTH}
                className="min-h-0 resize-none [field-sizing:content]"
              />
              <p className="text-xs text-muted-foreground">{caption}</p>
            </div>
          ))}

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
              aria-label={isRecording ? 'Stop dictation' : 'Dictate context'}
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
          Dictation didn&apos;t start: {dictation.error}. Check your microphone
          permission and try again.
        </p>
      )}

      {hasUnfilledBracket(lines) && (
        <p className="text-sm text-foreground">
          Fill in the square brackets before you walk — a canvasser reading
          &ldquo;[date]&rdquo; at a door has nothing to say.
        </p>
      )}
    </div>
  )
}
