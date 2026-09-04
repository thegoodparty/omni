'use client'

import type { SocialAsset, SocialAssetPlatform } from '@goodparty_org/contracts'
import { Button, Card, Input, Label } from '@styleguide'
import { SOCIAL_PLATFORMS } from '../socialPlatforms'
import { SocialAssetCard } from '../SocialAssetCards'
import { Intro } from './Intro'
import { ThinkingStream } from './ThinkingStream'

interface ShareStepProps {
  platforms: SocialAssetPlatform[]
  assets: SocialAsset[] | null
  isGenerating: boolean
  isError: boolean
  onRetry: () => void
  name: string
  onNameChange: (name: string) => void
}

export const ShareStep = ({
  platforms,
  assets,
  isGenerating,
  isError,
  onRetry,
  name,
  onNameChange,
}: ShareStepProps) => {
  // Render in the canonical platform order regardless of toggle order.
  const orderedAssets = SOCIAL_PLATFORMS.filter(
    (platform) => platforms.includes(platform.id) && assets,
  )
    .map((platform) => assets?.find((a) => a.platform === platform.id))
    .filter((asset): asset is SocialAsset => Boolean(asset))

  return (
    <div className="space-y-6">
      <Intro
        title="Your assets are ready"
        body="Copy the post text or read the script on camera. Free to share — no ad spend required."
      />

      {isGenerating && <ThinkingStream />}

      {isError && !isGenerating && (
        <Card className="items-start gap-3 p-4">
          <p className="text-sm text-foreground">
            We couldn&apos;t adapt your message just now. Nothing was saved —
            try again.
          </p>
          <Button type="button" size="small" onClick={onRetry}>
            Try again
          </Button>
        </Card>
      )}

      {!isGenerating && !isError && (
        <>
          <div className="space-y-4">
            {orderedAssets.map((asset) => (
              <SocialAssetCard key={asset.platform} asset={asset} />
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="social-campaign-name">Campaign name</Label>
            <Input
              id="social-campaign-name"
              value={name}
              maxLength={60}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Name this campaign"
            />
            <p className="text-xs text-muted-foreground">
              How this campaign appears in your outreach history.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
