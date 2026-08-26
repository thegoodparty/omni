'use client'

import { useEffect, useState } from 'react'
import {
  PHONE_BANKING_MAX_SHEET_COUNT,
  PHONE_BANKING_SHEET_SIZE,
} from '@goodparty_org/contracts'
import { Alert, AlertDescription, Input, Label } from '@styleguide'
import { Intro } from '../social/Intro'

interface SheetCountStepProps {
  sheetCount: number
  onSheetCountChange: (count: number) => void
  createErrorMessage: string | null
  // Pre-freeze reachable count from the audience step (null while it hasn't
  // resolved yet) — drives the coverage line and the over-capacity warning.
  reachableCount: number | null
}

const isValidSheetCount = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= PHONE_BANKING_MAX_SHEET_COUNT

export const SheetCountStep = ({
  sheetCount,
  onSheetCountChange,
  createErrorMessage,
  reachableCount,
}: SheetCountStepProps) => {
  // Raw typed text, distinct from the committed `sheetCount` prop — lets the
  // field go transiently empty (backspacing the only digit) without the
  // parent forcing it back to a placeholder value, which is what made
  // backspace-then-5 render "15" (ENG-10940).
  const [raw, setRaw] = useState(String(sheetCount))

  // Re-sync when the committed value changes out from under typing — a fresh
  // default once the audience count resolves, or the flow re-seeding on
  // reopen.
  useEffect(() => {
    setRaw(String(sheetCount))
  }, [sheetCount])

  const commit = (value: string) => {
    const n = parseInt(value, 10)
    if (isValidSheetCount(n)) {
      // Normalize to the canonical digits even when `n` already equals the
      // committed sheetCount — otherwise trailing junk parseInt ignores
      // (e.g. "5.9", "05") would linger on screen forever: the resync effect
      // below only fires on a genuine sheetCount CHANGE, so a same-value
      // commit wouldn't otherwise touch `raw`.
      setRaw(String(n))
      onSheetCountChange(n)
    } else {
      // Empty or out-of-range never leaves the component — snap back to the
      // last committed value.
      setRaw(String(sheetCount))
    }
  }

  const maxReach = sheetCount * PHONE_BANKING_SHEET_SIZE
  const overCapacity = reachableCount !== null && reachableCount > maxReach

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title="How many call sheets would you like me to create?"
        body="Creating multiple call sheets makes it simpler to share with volunteers, friends, and family."
      />
      <div className="space-y-2">
        <Label htmlFor="phone-banking-sheet-count">Number of call sheets</Label>
        <Input
          id="phone-banking-sheet-count"
          type="number"
          inputMode="numeric"
          min={1}
          max={PHONE_BANKING_MAX_SHEET_COUNT}
          value={raw}
          onChange={(e) => {
            const value = e.target.value
            const n = parseInt(value, 10)
            if (isValidSheetCount(n)) {
              // Same normalization as commit()'s valid branch — a keystroke
              // that parses to the already-committed count (a stray "5.9"
              // typed over a committed "5") must not leave that junk on
              // screen just because the committed value didn't change.
              setRaw(String(n))
              onSheetCountChange(n)
            } else {
              setRaw(value)
            }
          }}
          onBlur={() => commit(raw)}
        />
        <p className="text-sm text-muted-foreground">
          Each call sheet holds {PHONE_BANKING_SHEET_SIZE} numbers.
        </p>
        {reachableCount !== null && (
          <p className="text-sm text-muted-foreground">
            {`${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'} × ${PHONE_BANKING_SHEET_SIZE} = up to ${maxReach.toLocaleString()} of your ${reachableCount.toLocaleString()} reachable contacts`}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Between 1 and {PHONE_BANKING_MAX_SHEET_COUNT} call sheets.
        </p>
      </div>
      {overCapacity && reachableCount !== null && (
        <Alert variant="destructive">
          <AlertDescription>
            {`Only the first ~${maxReach.toLocaleString()} contacts will be included; ${(
              reachableCount - maxReach
            ).toLocaleString()} won't be called. Create another campaign with this same list afterward to call the rest — it picks up where this one leaves off.`}
          </AlertDescription>
        </Alert>
      )}
      {createErrorMessage && (
        <p className="text-sm text-destructive">{createErrorMessage}</p>
      )}
    </div>
  )
}
