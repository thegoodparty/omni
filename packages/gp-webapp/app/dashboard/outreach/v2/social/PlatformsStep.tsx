'use client'

import type { SocialAssetPlatform } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { SOCIAL_PLATFORMS } from '../socialPlatforms'
import { Intro } from './Intro'

interface PlatformsStepProps {
  selected: SocialAssetPlatform[]
  onToggle: (platform: SocialAssetPlatform) => void
}

export const PlatformsStep = ({ selected, onToggle }: PlatformsStepProps) => (
  <div className="space-y-6">
    <Intro
      title="Where do you want to share it?"
      body="All platforms are on by default. Turn off any you don't want. We'll adapt your draft into post copy or a video script for each one."
    />

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {SOCIAL_PLATFORMS.map((platform) => {
        const active = selected.includes(platform.id)
        return (
          <Card
            key={platform.id}
            role="button"
            aria-pressed={active}
            tabIndex={0}
            onClick={() => onToggle(platform.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle(platform.id)
              }
            }}
            className={cn(
              'relative items-center gap-2 rounded-2xl p-4 text-center transition-colors',
              active ? 'border-primary' : 'hover:border-primary/50',
            )}
          >
            {active && (
              <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <CheckIcon className="size-3" />
              </span>
            )}
            <span className="flex size-10 items-center justify-center rounded-full bg-secondary-light text-foreground">
              {platform.icon}
            </span>
            <span className="text-sm font-medium text-foreground">
              {platform.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {platform.helper}
            </span>
          </Card>
        )
      })}
    </div>
  </div>
)
