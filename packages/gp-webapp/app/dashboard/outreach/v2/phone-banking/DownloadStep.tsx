'use client'

import { Input, Label } from '@styleguide'
import { Intro } from '../social/Intro'

interface DownloadStepProps {
  name: string
  onNameChange: (name: string) => void
  sheetCount: number
  createErrorMessage: string | null
}

export const DownloadStep = ({
  name,
  onNameChange,
  sheetCount,
  createErrorMessage,
}: DownloadStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="phoneBanking"
      title="Ready to build your call list"
      body={`We'll build ${sheetCount} sheet${sheetCount === 1 ? '' : 's'} of 60 numbers each from your audience and script.`}
    />
    <div className="space-y-2">
      <Label htmlFor="phone-banking-campaign-name">Campaign name</Label>
      <Input
        id="phone-banking-campaign-name"
        value={name}
        maxLength={60}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name this campaign"
      />
      <p className="text-xs text-muted-foreground">
        How this campaign appears in your outreach history.
      </p>
    </div>
    {createErrorMessage && (
      <p className="text-sm text-destructive">{createErrorMessage}</p>
    )}
  </div>
)
