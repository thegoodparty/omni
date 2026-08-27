'use client'

import type { SmsPurpose } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { SMS_PURPOSES } from './smsCompose.util'

interface SmsPurposeStepProps {
  selected: SmsPurpose | null
  onSelect: (purpose: SmsPurpose) => void
}

export const SmsPurposeStep = ({ selected, onSelect }: SmsPurposeStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="text"
      title="What do you want to do?"
      body="This helps us generate the best message for your campaign."
    />
    <div className="space-y-3">
      {SMS_PURPOSES.map((purpose) => (
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
