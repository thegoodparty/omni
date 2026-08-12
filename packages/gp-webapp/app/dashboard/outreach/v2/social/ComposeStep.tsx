'use client'

import type { ReactNode } from 'react'
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
  RefreshIcon,
  ThumbsUpIcon,
} from '@styleguide/components/ui/icons'
import { SOCIAL_TONES, type SocialTone } from './socialDrafts'
import { Intro } from './Intro'

// Approved-icons stand-ins for the prototype's Sun/Target/Clock/Smile tone
// glyphs (only icons.tsx icons are allowed in app code).
const TONE_ICONS: Record<SocialTone, ReactNode> = {
  Warm: <HandHeartIcon className="size-4" />,
  Direct: <ArrowRightIcon className="size-4" />,
  Urgent: <ClockIcon className="size-4" />,
  Friendly: <ThumbsUpIcon className="size-4" />,
}

interface ComposeStepProps {
  tone: SocialTone
  onToneChange: (tone: SocialTone) => void
  draft: string
  onDraftChange: (draft: string) => void
  onRegenerate: () => void
  // Undo appears only once a template action (Regenerate / tone switch) has
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
  canUndo,
  onUndo,
  isCustomPurpose,
}: ComposeStepProps) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to say?"
      body="Confirm the message. We'll adapt this draft to each platform's voice and length in the next steps."
    />

    {!isCustomPurpose && (
      <FilterPillGroup
        type="single"
        value={tone}
        onValueChange={(value) => value && onToneChange(value as SocialTone)}
      >
        {SOCIAL_TONES.map((t) => (
          <FilterPill key={t} value={t} className="gap-1.5">
            {TONE_ICONS[t]}
            {t}
          </FilterPill>
        ))}
      </FilterPillGroup>
    )}

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
              onClick={onRegenerate}
            >
              <RefreshIcon className="size-4" />
              Regenerate
            </Button>
          )}
        </div>
      </div>

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
    </div>
  </div>
)
