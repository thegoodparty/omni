'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  MERGE_TAGS,
  type MergeTagChannel,
  mergeTagToken,
  SMS_RESTRICTED_WORDS,
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
  seamlessFieldHost,
  TokenField,
  type TokenFieldRef,
  type TokenSpec,
} from '@styleguide'
import {
  ClockIcon,
  ImageIcon,
  Loader2Icon,
  LockIcon,
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
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  inMemoryCopy,
  OPT_OUT_FOOTER,
} from './smsCompose.util'

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
  serve: 'Add your header image',
} as const

const IMAGE_REQUIRED_ERROR = {
  win: 'Add your headshot or logo to continue.',
  serve: 'Add a header image to continue.',
} as const

const MESSAGE_REQUIRED_ERROR = 'Write your message to continue.'

interface SmsComposeStepProps {
  // Copy only. The surface config carries this for exactly the strings the
  // per-surface records cannot reach, which is what the label above is.
  isServe: boolean
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  standardsFailures: SmsRequiredPart[]
  // The restricted words the message actually contains, so the error names
  // only those.
  restrictedWords?: string[]
  unfilledBrackets: string[]
  // Set when the message carries a civic panel JOIN line it may not send.
  joinLineError?: string
  identificationExample: string
  // The exact "Paid for by" line the message should carry, or null on a
  // surface or a campaign with no committee to name.
  paidForByText: string | null
  // Puts a deleted required line back where the flow writes it.
  onAddRequiredBack: (rule: SmsRequiredPart) => void
  // The whole message as sent: greeting, body, disclaimer and opt-out.
  message: string
  onMessageChange: (message: string) => void
  mergeTagChannel: MergeTagChannel
  // Whether the candidate has written anything between the required parts.
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
  // Presses of Continue while something was missing. Nothing shows as missing
  // before the first, and each one moves to the first field still missing.
  continueAttempts: number
  // Serve's civic panel invite that GoodParty sends in the official's name:
  // its own title, no tone, image or panel ask, the JOIN line and opt-out
  // locked under the editable body, and what approving means above the button.
  // A dictated passage landed in the message.
  onDictated?: () => void
  managedInvite?: {
    title: string
    caption: string
    lockedLines: string
    // What approving means, shown just above the approve button.
    agreement: string
  }
}

export type SmsRequiredPart = SmsStandardsRule

// What is wrong and how to fix it, per missing required part: rule 8 of
// docs/product-copy.md. The greeting, name, disclaimer and opt-out are
// written by the flow and editable like any other text, so these
// fire when an edit deletes one, and each shows the exact line to restore
// plus a one-click way to restore it.
interface StandardsFailureCopy {
  problem: string
  fix: string
  // The exact words, shown as text to copy rather than in quotes to retype.
  line?: string
  // Names the Add it back button for a screen reader, which reads several.
  addBackLabel?: string
}

// The greeting as the official reads it in the field, not the merge token.
const GREETING_EXAMPLE = 'Hello [First name],'

export const standardsFailureCopy = (
  rule: SmsRequiredPart,
  {
    identificationExample,
    paidForByText,
    restrictedWords = [],
  }: {
    identificationExample: string
    paidForByText: string | null
    restrictedWords?: readonly string[]
  },
): StandardsFailureCopy => {
  if (rule === 'candidate_name') {
    return {
      problem: 'Your text needs your name.',
      fix: 'Add it back at the start:',
      line: identificationExample,
      addBackLabel: 'Add your name back',
    }
  }
  if (rule === 'opt_out_line') {
    return {
      problem: 'Your text needs its opt-out line.',
      fix: 'Add it back as the last line:',
      line: OPT_OUT_FOOTER,
      addBackLabel: 'Add the opt-out line back',
    }
  }
  if (rule === 'first_name_token') {
    return {
      problem: 'Your text needs its greeting, so each person sees their name.',
      fix: 'Add it back at the start:',
      line: GREETING_EXAMPLE,
      addBackLabel: 'Add the greeting back',
    }
  }
  if (rule === 'paid_for_by') {
    return {
      problem: 'Your text needs its disclaimer.',
      fix: 'Add it back before the opt-out line:',
      ...(paidForByText && {
        line: paidForByText,
        addBackLabel: 'Add the disclaimer back',
      }),
    }
  }
  if (rule === 'link_shortener') {
    return {
      problem: 'Your text has a shortened link, like bit.ly.',
      fix: 'Paste the full web address instead.',
    }
  }
  if (rule === 'restricted_word') {
    const words =
      restrictedWords.length > 0 ? restrictedWords : SMS_RESTRICTED_WORDS
    return {
      problem: 'Your text has a word our texting provider won\u2019t send.',
      fix: `Reword it without ${words.map((word) => `\u201c${word}\u201d`).join(' or ')}.`,
    }
  }
  return {
    problem: 'Your text is over the length limit.',
    fix: 'Shorten it to continue.',
  }
}

export const SmsComposeStep = ({
  isServe,
  tone,
  onToneChange,
  standardsFailures,
  restrictedWords,
  unfilledBrackets,
  joinLineError,
  identificationExample,
  paidForByText,
  onAddRequiredBack,
  message,
  onMessageChange,
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
  continueAttempts,
  onDictated,
  managedInvite,
}: SmsComposeStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropzoneRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<TokenFieldRef>(null)
  const attempted = continueAttempts > 0
  const imageMissing = attempted && !imagePreviewUrl && !managedInvite
  const messageMissing = attempted && !hasWrittenBody
  // Dictation lands at the cursor, not at the end: the end of the message is
  // the opt-out line, and nothing may follow it.
  const dictation = useDictation({
    analyticsLabel: 'outreach-sms-compose',
    onFinalTranscript: (text) => {
      if (!text) return
      fieldRef.current?.insertText(` ${text}`)
      onDictated?.()
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
    },
  ]
  const isImprove = aiAction === 'improve'
  const overLimit = composedLength > SMS_COMPOSED_MAX_LENGTH
  const segments = Math.max(1, Math.ceil(composedLength / 160))

  // Moves to the first field still missing, top to bottom: the image, then
  // the message. Keyed on the press count alone so typing never steals focus.
  useEffect(() => {
    if (continueAttempts === 0) return
    if (!imagePreviewUrl && !managedInvite) {
      dropzoneRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      })
      dropzoneRef.current?.focus({ preventScroll: true })
      return
    }
    fieldRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per press, not per edit
  }, [continueAttempts])

  const handleFile = async (file: File | null) => {
    if (!file) return
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      onImageError('Use a JPG, PNG, or GIF image.')
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      onImageError('Image too large — choose one under 500 KB.')
      return
    }
    let snapshot: File
    try {
      snapshot = await inMemoryCopy(file)
    } catch {
      onImageError(
        "We couldn't open that image. Choose it again or pick another.",
      )
      return
    }
    onImageError(null)
    onImageChange(snapshot)
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="text"
        title={managedInvite?.title ?? 'What do you want to say?'}
        body={
          managedInvite?.caption ??
          'Start from a draft, dictate your own, or improve with AI.'
        }
      />

      {managedInvite ? null : (
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
      )}

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

        <Card className={cn('gap-0 p-4', seamlessFieldHost)}>
          {managedInvite ? null : imagePreviewUrl ? (
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
            <div className="mb-4 space-y-2">
              <button
                ref={dropzoneRef}
                type="button"
                data-slot="sms-image-dropzone"
                onClick={() => fileInputRef.current?.click()}
                aria-invalid={imageMissing || undefined}
                aria-describedby={
                  imageMissing ? 'sms-image-required' : undefined
                }
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 transition-colors hover:border-primary/50 hover:bg-muted',
                  imageMissing && 'border-destructive',
                )}
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
              {imageMissing && (
                <p id="sms-image-required" className="text-xs text-destructive">
                  {isServe
                    ? IMAGE_REQUIRED_ERROR.serve
                    : IMAGE_REQUIRED_ERROR.win}
                </p>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0] ?? null)
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
          {messageMissing && (
            <p className="text-xs text-destructive">{MESSAGE_REQUIRED_ERROR}</p>
          )}
          {managedInvite ? (
            <div
              className="mt-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
              data-testid="managed-invite-locked-lines"
            >
              <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="whitespace-pre-line">
                {managedInvite.lockedLines}
              </span>
            </div>
          ) : null}

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
            .map((rule) => {
              const copy = standardsFailureCopy(rule, {
                identificationExample,
                paidForByText,
                restrictedWords,
              })
              return (
                <div
                  key={rule}
                  className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
                >
                  <p>
                    {copy.problem} {copy.fix}
                    {copy.line && (
                      <>
                        {' '}
                        <span className="select-all rounded bg-muted px-1 font-mono text-foreground">
                          {copy.line}
                        </span>
                      </>
                    )}
                  </p>
                  {copy.addBackLabel && (
                    <Button
                      type="button"
                      variant="link"
                      size="small"
                      className="h-auto px-0 text-xs"
                      aria-label={copy.addBackLabel}
                      onClick={() => onAddRequiredBack(rule)}
                    >
                      Add it back
                    </Button>
                  )}
                </div>
              )
            })}
        {joinLineError && (
          <p className="text-xs text-destructive">{joinLineError}</p>
        )}
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
        {managedInvite && (
          <p className="text-sm text-muted-foreground">
            {managedInvite.agreement}
          </p>
        )}
      </div>
    </div>
  )
}
