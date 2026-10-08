'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  MERGE_TAGS,
  type MergeTagChannel,
  mergeTagToken,
  type SmsProtectedPart,
  type SmsStandardsRule,
  SOCIAL_TONE_VALUES,
  type SocialTone,
} from '@goodparty_org/contracts'
import { SMS_COMPOSED_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  type ProtectedSpec,
  TokenField,
  type TokenFieldRef,
  type TokenSpec,
} from '@styleguide'
import {
  ClockIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  RefreshIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import {
  type DictationStatus,
  useDictation,
} from 'app/dashboard/shared/dictation/useDictation'
import { Intro } from '../social/Intro'
import { IMAGE_ACCEPT, IMAGE_MAX_BYTES } from './smsCompose.util'

// Why each locked part cannot change, shown when an edit runs into it. Both
// surfaces read the same words: none of them names voters or constituents.
// Partial because link_shortener forbids text rather than requiring it, so
// nothing is ever locked for it.
const LOCK_REASONS: Partial<Record<SmsProtectedPart['rule'], string>> = {
  first_name_token: 'Keep the first name so each person sees their own.',
  candidate_name:
    "Your name stays so people know who's texting, but you can reword anything around it.",
  paid_for_by: 'The law requires this line, but you can write around it.',
  opt_out_line:
    'Every text has to offer a way to opt out, but you can write around it.',
}

const LOCKED_FALLBACK =
  'This part is required, but you can reword anything around it.'
const FIRST_NAME_TAG = MERGE_TAGS[0]

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'connecting',
  'recording',
  'stopping',
])

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

// The image dropzone is the one string in this shared step that names the
// product. "Campaign" is Win vocabulary (docs/product-vocabulary.md): an
// elected official has an office and a term, not a campaign. Keyed rather
// than renamed, because a candidate uploading a campaign headshot is the
// right words for them.
const IMAGE_DROPZONE_LABEL = {
  win: 'Add your campaign headshot or logo',
  serve: 'Add a header image (optional)',
} as const

interface SmsComposeStepProps {
  // Copy only. The surface config carries this for exactly the strings the
  // per-surface records cannot reach, which is what the label above is.
  isServe: boolean
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  standardsFailures: SmsStandardsRule[]
  unfilledBrackets: string[]
  identificationExample: string
  // The whole message as sent: greeting, body, disclaimer and opt-out.
  message: string
  onMessageChange: (message: string) => void
  // The parts of `message` nobody may change, from deriveSmsProtectedParts.
  protectedParts: SmsProtectedPart[]
  mergeTagChannel: MergeTagChannel
  // Whether the candidate has written anything between the locked parts.
  hasWrittenBody: boolean
  composedLength: number
  // The one AI action: a fresh draft while the words are still the AI's,
  // a polish once they are the candidate's own.
  aiAction: 'regenerate' | 'improve'
  onAiAction: () => void
  isDrafting: boolean
  isDraftError: boolean
  canUndo: boolean
  onUndo: () => void
  imagePreviewUrl: string | null
  onImageChange: (file: File | null) => void
  imageError: string | null
  onImageError: (message: string | null) => void
}

// Plain-language fix per failed compliance rule. The greeting, opt-out, and
// paid-for-by lines are system-owned, so these mostly fire only when an edit
// deletes one of them.
const standardsFailureCopy = (
  rule: SmsStandardsRule,
  identificationExample: string,
): string => {
  if (rule === 'candidate_name') {
    return `messages must include your name, e.g. "${identificationExample}"`
  }
  if (rule === 'opt_out_line') return 'keep the "Reply STOP" opt-out line'
  if (rule === 'first_name_token') {
    return 'keep the {first_name} greeting token'
  }
  if (rule === 'paid_for_by') return 'keep the "Paid for by" line'
  if (rule === 'link_shortener') {
    return 'links must not use a shortener like bit.ly — paste the full web address instead'
  }
  return 'shorten the message to fit the length limit'
}

export const SmsComposeStep = ({
  isServe,
  tone,
  onToneChange,
  standardsFailures,
  unfilledBrackets,
  identificationExample,
  message,
  onMessageChange,
  protectedParts,
  mergeTagChannel,
  hasWrittenBody,
  composedLength,
  aiAction,
  onAiAction,
  isDrafting,
  isDraftError,
  canUndo,
  onUndo,
  imagePreviewUrl,
  onImageChange,
  imageError,
  onImageError,
}: SmsComposeStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<TokenFieldRef>(null)
  const [lockReason, setLockReason] = useState<string | null>(null)
  // Dictation lands at the cursor, not at the end: the end of the message is
  // the opt-out line, and nothing may follow it.
  const dictation = useDictation({
    analyticsLabel: 'outreach-sms-compose',
    onFinalTranscript: (text) => {
      if (text) fieldRef.current?.insertText(` ${text}`)
    },
  })
  const isRecording = dictation.status === 'recording'
  const dictationBusy = ACTIVE_DICTATION.has(dictation.status) && !isRecording
  const toggleDictation = useCallback(async () => {
    if (ACTIVE_DICTATION.has(dictation.status)) await dictation.stop()
    else await dictation.start()
  }, [dictation])

  const firstNameText = mergeTagToken(FIRST_NAME_TAG.id, mergeTagChannel)
  const tokens: TokenSpec[] = [
    {
      id: FIRST_NAME_TAG.id,
      label: FIRST_NAME_TAG.label,
      text: firstNameText,
      required: protectedParts.some((part) => part.kind === 'token'),
    },
  ]
  const protectedRanges: ProtectedSpec[] = protectedParts.flatMap((part) =>
    part.kind === 'phrase'
      ? [
          {
            id: part.rule,
            text: part.text,
            // The copy the lock rules chose (the footer, not a quote of it).
            start: part.start,
            reason: LOCK_REASONS[part.rule] ?? LOCKED_FALLBACK,
          },
        ]
      : [],
  )
  const isImprove = aiAction === 'improve'
  useEffect(() => {
    setLockReason(null)
  }, [message])
  const overLimit = composedLength > SMS_COMPOSED_MAX_LENGTH
  const segments = Math.max(1, Math.ceil(composedLength / 160))

  const handleFile = (file: File | null) => {
    if (!file) return
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      onImageError('Use a JPG, PNG, or GIF image.')
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      onImageError('Image too large — choose one under 500 KB.')
      return
    }
    onImageError(null)
    onImageChange(file)
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="text"
        title="What do you want to say?"
        body="Start from a draft, dictate your own, or improve with AI."
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
        {isDraftError && (
          <Card className="items-start gap-3 border-destructive p-4">
            <p className="text-sm text-foreground">
              We couldn&apos;t draft your message just now. Try again, or write
              your own below.
            </p>
            <Button type="button" size="small" onClick={onAiAction}>
              Try again
            </Button>
          </Card>
        )}

        <Card className="gap-0 p-4">
          {imagePreviewUrl ? (
            <div className="relative mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- local
                    object URL preview of an unuploaded file */}
              <img
                src={imagePreviewUrl}
                alt="Attachment preview"
                className="max-h-56 w-full rounded-xl border border-border object-cover"
              />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => onImageChange(null)}
                className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/80 text-background hover:bg-foreground"
              >
                <XMarkIcon className="size-3.5" />
              </button>
            </div>
          ) : (
            // globals.css forces flex-row on data-slot-less flex buttons
            // (legacy link/button normalization); the slot opts out so
            // the dropzone stacks like the design.
            <button
              type="button"
              data-slot="sms-image-dropzone"
              onClick={() => fileInputRef.current?.click()}
              className="mb-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 transition-colors hover:border-primary/50 hover:bg-muted"
            >
              <ImageIcon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {isServe
                  ? IMAGE_DROPZONE_LABEL.serve
                  : IMAGE_DROPZONE_LABEL.win}
              </span>
              <span className="text-xs text-muted-foreground">
                Recipients see this in the message preview
              </span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />

          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Your message
            </span>
            <span
              className={cn(
                'text-xs tabular-nums text-muted-foreground',
                overLimit && 'text-destructive',
              )}
            >
              {composedLength} chars · {segments} SMS
            </span>
          </div>
          <TokenField
            ref={fieldRef}
            value={message}
            onChange={onMessageChange}
            tokens={tokens}
            protectedRanges={protectedRanges}
            onBlockedEdit={(target) =>
              setLockReason(
                'reason' in target
                  ? target.reason
                  : (LOCK_REASONS.first_name_token ?? LOCKED_FALLBACK),
              )
            }
            // Read-only until the first draft lands, so nothing typed is
            // overwritten by it.
            readOnly={isDrafting && !message.trim()}
            placeholder={
              isDrafting && !message.trim()
                ? 'Drafting your message…'
                : 'Write your message…'
            }
            aria-label="Message body"
            aria-invalid={overLimit}
            variant="seamless"
            className="min-h-[140px]"
          />
          <p role="status" className="mt-1 min-h-4 text-xs text-foreground">
            {lockReason}
          </p>

          <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t border-border p-2">
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
            {(!isImprove || hasWrittenBody) && (
              <Button
                type="button"
                variant="ghost"
                size="small"
                className="text-muted-foreground"
                // The polish endpoint takes a message within the limit; over
                // it, the note below says to shorten it first.
                disabled={isDrafting || (isImprove && overLimit)}
                onClick={onAiAction}
              >
                {isDrafting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : isImprove ? (
                  <SparklesIcon className="size-4" />
                ) : (
                  <RefreshIcon className="size-4" />
                )}
                {isImprove ? 'Improve with AI' : 'Regenerate'}
              </Button>
            )}
            <IconButton
              type="button"
              variant={isRecording ? 'destructive' : 'ghost'}
              size="small"
              aria-label={isRecording ? 'Stop dictation' : 'Dictate message'}
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
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}
        {hasWrittenBody &&
          standardsFailures
            .filter((rule) => rule !== 'length')
            .map((rule) => (
              <p key={rule} className="text-xs text-destructive">
                Compliance: {standardsFailureCopy(rule, identificationExample)}
              </p>
            ))}
        {unfilledBrackets.length > 0 && (
          <p className="text-xs text-destructive">
            Your message still has {unfilledBrackets.join(', ')}. Replace{' '}
            {unfilledBrackets.length === 1 ? 'it' : 'them'} with the real
            details before you send.
          </p>
        )}
        {overLimit && (
          <p className="text-xs text-destructive">
            Keep the whole message (including the identification and opt-out
            lines) under {SMS_COMPOSED_MAX_LENGTH} characters.
          </p>
        )}
      </div>
    </div>
  )
}
