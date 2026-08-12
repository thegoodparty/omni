'use client'

import type { SocialPurpose } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { SOCIAL_PURPOSES } from '../socialPurposes'
import { Intro } from './Intro'

interface PurposeStepProps {
  selected: SocialPurpose | null
  onSelect: (purpose: SocialPurpose) => void
}

export const PurposeStep = ({ selected, onSelect }: PurposeStepProps) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us tailor your message and choose the right platforms."
    />
    <div className="space-y-3">
      {SOCIAL_PURPOSES.map((purpose) => (
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
