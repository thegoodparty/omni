'use client'

import { useRef } from 'react'
import type { ReactNode } from 'react'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import { SMS_COMPOSED_MAX_LENGTH } from '@goodparty_org/contracts'
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
  ImageIcon,
  Loader2Icon,
  MicIcon,
  RefreshIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { Intro } from '../social/Intro'
import { ThinkingStream } from '../social/ThinkingStream'
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  OPT_OUT_FOOTER,
} from './smsCompose.util'

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

interface SmsComposeStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  audienceName: string
  intro: string
  body: string
  onBodyChange: (body: string) => void
  composedLength: number
  onRegenerate: () => void
  onImprove: () => void
  canImprove: boolean
  isDrafting: boolean
  isDraftError: boolean
  canUndo: boolean
  onUndo: () => void
  isCustomPurpose: boolean
  image: File | null
  imagePreviewUrl: string | null
  onImageChange: (file: File | null) => void
  imageError: string | null
  onImageError: (message: string | null) => void
}

export const SmsComposeStep = ({
  tone,
  onToneChange,
  audienceName,
  intro,
  body,
  onBodyChange,
  composedLength,
  onRegenerate,
  onImprove,
  canImprove,
  isDrafting,
  isDraftError,
  canUndo,
  onUndo,
  isCustomPurpose,
  image,
  imagePreviewUrl,
  onImageChange,
  imageError,
  onImageError,
}: SmsComposeStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dictation = useDictationAppend({
    analyticsLabel: 'outreach-sms-compose',
    value: body,
    onChange: onBodyChange,
  })
  const isRecording = dictation.status === 'recording'
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
        body="Start from a draft, dictate your own, or improve with AI. We add your identification and the opt-out line automatically."
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
          <p className="text-sm text-muted-foreground">
            Suggested for {audienceName || 'your list'}
          </p>
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
            <Button
              type="button"
              size="small"
              onClick={isCustomPurpose ? onImprove : onRegenerate}
            >
              Try again
            </Button>
          </Card>
        )}

        {isDrafting && !body.trim() ? (
          <ThinkingStream />
        ) : (
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
                <IconButton
                  type="button"
                  variant="secondary"
                  size="small"
                  aria-label="Remove image"
                  className="absolute right-2 top-2"
                  onClick={() => onImageChange(null)}
                >
                  <Trash2Icon className="size-4" />
                </IconButton>
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
                  Add your campaign headshot or logo
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
            <p className="mb-1">
              <span className="inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary-dark">
                Greeting First Name
              </span>
            </p>
            <p className="mb-2 text-xs text-muted-foreground">{intro}</p>
            <Textarea
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Write your message…"
              aria-label="Message body"
              aria-invalid={overLimit}
              className="min-h-[140px] resize-none border-0 p-0 focus-visible:ring-0 [field-sizing:content]"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {OPT_OUT_FOOTER}
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
        )}
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}
        {overLimit && (
          <p className="text-xs text-destructive">
            Keep the whole message (including the identification and opt-out
            lines) under {SMS_COMPOSED_MAX_LENGTH} characters.
          </p>
        )}
        {!image && (
          <p className="text-xs text-muted-foreground">
            An image is required for text campaigns — JPG, PNG, or GIF up to 500
            KB.
          </p>
        )}
      </div>
    </div>
  )
}
