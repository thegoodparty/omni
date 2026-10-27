'use client'

import { Badge, Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { FREE_OFFER_BADGE } from 'app/dashboard/shared/robocallFreeOffer/freeOfferCopy'
import { ROBOCALL_PURPOSES, type RobocallPurpose } from '../robocallPurposes'
// Intro is a channel-generic v2 component that currently lives under social/;
// reused here read-only (a later refactor can relocate it to v2/).
import { Intro } from '../social/Intro'

interface RobocallPurposeStepProps {
  selected: RobocallPurpose | null
  onSelect: (purpose: RobocallPurpose) => void
  // The purpose the free election-eve robocall offer belongs to, badged when
  // the campaign has the offer.
  freeOfferPurpose?: RobocallPurpose | null
}

export const RobocallPurposeStep = ({
  selected,
  onSelect,
  freeOfferPurpose = null,
}: RobocallPurposeStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="robocall"
      title="What do you want to do?"
      body="This helps us tailor the script your voters will hear."
    />
    <div className="space-y-3">
      {ROBOCALL_PURPOSES.map((purpose) => (
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
          <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            {purpose.label}
            {purpose.id === freeOfferPurpose && (
              <Badge>{FREE_OFFER_BADGE}</Badge>
            )}
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </Card>
      ))}
    </div>
  </div>
)
