'use client'

import { PHONE_BANKING_MAX_SHEET_COUNT } from '@goodparty_org/contracts'
import { Input, Label } from '@styleguide'
import { Intro } from '../social/Intro'

interface SheetCountStepProps {
  sheetCount: number
  onSheetCountChange: (count: number) => void
  createErrorMessage: string | null
}

export const SheetCountStep = ({
  sheetCount,
  onSheetCountChange,
  createErrorMessage,
}: SheetCountStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="phoneBanking"
      title="How many lists would you like me to create?"
      body="Creating multiple lists makes it simpler to share with volunteers, friends, and family."
    />
    <div className="space-y-2">
      <Label htmlFor="phone-banking-sheet-count">Number of lists</Label>
      <Input
        id="phone-banking-sheet-count"
        type="number"
        inputMode="numeric"
        min={1}
        max={PHONE_BANKING_MAX_SHEET_COUNT}
        value={Number.isFinite(sheetCount) ? sheetCount : ''}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (Number.isNaN(n)) {
            onSheetCountChange(1)
            return
          }
          onSheetCountChange(
            Math.max(1, Math.min(PHONE_BANKING_MAX_SHEET_COUNT, n)),
          )
        }}
      />
      <p className="text-sm text-muted-foreground">
        Between 1 and {PHONE_BANKING_MAX_SHEET_COUNT} lists.
      </p>
    </div>
    {createErrorMessage && (
      <p className="text-sm text-destructive">{createErrorMessage}</p>
    )}
  </div>
)
