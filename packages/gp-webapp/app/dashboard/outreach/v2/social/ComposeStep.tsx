'use client'

import type { ReactNode } from 'react'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import {
  Button,
  Card,
  FilterPill,
  FilterPillGroup,
  Textarea,
} from '@styleguide'
import {
  ArrowRightIcon,
  ClockIcon,
  HandHeartIcon,
  Loader2Icon,
  RefreshIcon,
  ThumbsUpIcon,
} from '@styleguide/components/ui/icons'
import { ThinkingStream } from './ThinkingStream'
import { Intro } from './Intro'

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

// Approved-icons stand-ins for the prototype's Sun/Target/Clock/Smile tone
// glyphs (only icons.tsx icons are allowed in app code).
const TONE_ICONS: Record<SocialTone, ReactNode> = {
  warm: <HandHeartIcon className="size-4" />,
  direct: <ArrowRightIcon className="size-4" />,
  urgent: <ClockIcon className="size-4" />,
  friendly: <ThumbsUpIcon className="size-4" />,
}

interface ComposeStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  draft: string
  onDraftChange: (draft: string) => void
  onRegenerate: () => void
  isDrafting: boolean
  isDraftError: boolean
  // Undo appears only once a generated draft (Regenerate / tone switch) has
  // replaced manually typed text — never from tone-preset-only interaction.
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
  isDrafting,
  isDraftError,
  canUndo,
  onUndo,
  isCustomPurpose,
}: ComposeStepProps) => (
  <div className="space-y-6">
    <Intro
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
          {canUndo && (
            <Button
              type="button"
              variant="link"
              size="small"
              className="h-auto px-0"
              onClick={onUndo}
            >
              Undo
            </Button>
          )}
          {!isCustomPurpose && (
            <Button
              type="button"
              variant="link"
              size="small"
              className="h-auto gap-1.5 px-0"
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
          <Button type="button" size="small" onClick={onRegenerate}>
            Try again
          </Button>
        </Card>
      )}

      {isDrafting && !draft.trim() ? (
        <ThinkingStream />
      ) : (
        <Card className="p-4">
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Write your message…"
            aria-label="Draft message"
            maxLength={2000}
            className="min-h-[140px] resize-none border-0 p-0 focus-visible:ring-0 [field-sizing:content]"
          />
        </Card>
      )}
    </div>
  </div>
)
