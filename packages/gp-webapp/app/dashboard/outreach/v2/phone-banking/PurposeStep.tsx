'use client'

import type {
  PhoneBankingPurpose,
  ServePhoneBankingPurpose,
} from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
// Intro is a channel-generic v2 component that currently lives under
// social/; reused read-only here (same precedent as RobocallPurposeStep).
import { Intro } from '../social/Intro'

interface PurposeStepProps {
  purposes: {
    id: PhoneBankingPurpose | ServePhoneBankingPurpose
    label: string
  }[]
  selected: PhoneBankingPurpose | ServePhoneBankingPurpose | null
  onSelect: (purpose: PhoneBankingPurpose | ServePhoneBankingPurpose) => void
}

export const PurposeStep = ({
  purposes,
  selected,
  onSelect,
}: PurposeStepProps) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us tailor your script and who to call."
    />
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
