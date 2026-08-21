'use client'

import { PHONE_BANKING_MAX_SHEET_COUNT } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { Intro } from '../social/Intro'

interface SheetCountStepProps {
  sheetCount: number
  onSheetCountChange: (count: number) => void
}

const SHEET_COUNT_OPTIONS = Array.from(
  { length: PHONE_BANKING_MAX_SHEET_COUNT },
  (_, i) => i + 1,
)

export const SheetCountStep = ({
  sheetCount,
  onSheetCountChange,
}: SheetCountStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="phoneBanking"
      title="How many sheets do you need?"
      body="Each sheet holds 60 numbers, split evenly across your volunteers."
    />
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {SHEET_COUNT_OPTIONS.map((count) => (
        <Card
          key={count}
          role="button"
          tabIndex={0}
          onClick={() => onSheetCountChange(count)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSheetCountChange(count)
            }
          }}
          className={cn(
            'items-center justify-center rounded-lg p-3 text-center transition-colors',
            count === sheetCount
              ? 'border-primary bg-primary/5'
              : 'hover:border-primary/50',
          )}
        >
          <span className="text-lg font-semibold text-foreground">{count}</span>
        </Card>
      ))}
    </div>
    <p className="text-sm text-muted-foreground">
      {sheetCount} sheet{sheetCount === 1 ? '' : 's'} ·{' '}
      {(sheetCount * 60).toLocaleString()} numbers total
    </p>
  </div>
)
