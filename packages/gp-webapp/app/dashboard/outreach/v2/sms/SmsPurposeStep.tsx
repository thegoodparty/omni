'use client'

import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { SMS_PURPOSES, type SmsFlowPurpose } from './smsCompose.util'

// Win's copy, kept as the default so a caller that passes no surface-owned
// overrides renders exactly what it rendered before the flow was
// parametrized.
export const SMS_PURPOSE_INTRO_BODY =
  'This helps us generate the best message for your campaign.'

interface SmsPurposeStepProps {
  selected: SmsFlowPurpose | null
  onSelect: (purpose: SmsFlowPurpose) => void
  // Supplied by the flow's surface: Win's slugs, or Serve's constituent
  // vocabulary. Defaulted so the Win call site is unchanged.
  purposes?: { id: SmsFlowPurpose; label: string }[]
  introBody?: string
}

export const SmsPurposeStep = ({
  selected,
  onSelect,
  purposes = SMS_PURPOSES,
  introBody = SMS_PURPOSE_INTRO_BODY,
}: SmsPurposeStepProps) => (
  <div className="space-y-6">
    <Intro channel="text" title="What do you want to do?" body={introBody} />
    <div className="space-y-3">
      {purposes.map((purpose) => (
        <Card
          key={purpose.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(purpose.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(purpose.id)
            }
          }}
          className={cn(
            'flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
            purpose.id === selected
              ? 'border-primary'
              : 'hover:border-primary/50',
          )}
        >
          <span className="font-medium text-foreground">{purpose.label}</span>
          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </Card>
      ))}
    </div>
  </div>
)
