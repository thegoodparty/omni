'use client'

import { useEffect, useState } from 'react'
import { Drawer as VaulDrawer } from 'vaul'
import {
  Button,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Input,
  Label,
} from '@styleguide'

interface RecommendedListNameDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The recommendation's `copy.title`, pre-filled into the input. The
  // candidate can edit before Continue; the input's live value is what
  // reaches the server as the saved list's name.
  defaultName: string
  // Awaited on submit. Throws → the drawer catches and shows an inline
  // error in place of advancing; the drawer stays open so the candidate
  // can retry or edit.
  onSubmit: (name: string) => Promise<void>
}

// Naming drawer for a picked recommendation. Nested under the audience
// step's own vaul `Drawer` — `VaulDrawer.NestedRoot` (rather than the
// styleguide's `Root`-wrapping `Drawer`) is what makes the outer sheet
// scale back to give this one visual depth and keeps focus/scroll traps
// stacked cleanly. Editing the recommendation's filters was never the
// point of this pass; only the name is exposed.
export const RecommendedListNameDrawer = ({
  open,
  onOpenChange,
  defaultName,
  onSubmit,
}: RecommendedListNameDrawerProps) => {
  const [name, setName] = useState(defaultName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reseed the input when the drawer opens for a new recommendation —
  // otherwise a second open (or a different picked card) would carry the
  // previous submission's typed value.
  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setError(null)
  }, [open, defaultName])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
    } catch {
      // The audience hook's createRecommendedList throws on failure; keep
      // the drawer open with an inline message rather than blowing up.
      setError("We couldn't save this list. Try again.")
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  return (
    <VaulDrawer.NestedRoot open={open} onOpenChange={onOpenChange}>
      {/* No X anywhere on this drawer — Continue in the footer is the
          deliberate exit, and this sheet is nested inside OutreachSheet
          whose own X already covers "exit the whole flow". Two X's on
          screen at once (parent + child) reads as noise. Handle drag,
          Escape, and outside-click still dismiss. */}
      <DrawerContent closeClassName="hidden">
        <DrawerHandle />
        <DrawerHeader hideClose>
          <DrawerTitle>Name this list</DrawerTitle>
          <DrawerDescription>
            Give this list a name so you can find it later.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <form
            className="flex flex-col gap-2 py-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
          >
            <Label htmlFor="recommended-list-name">List name</Label>
            <Input
              id="recommended-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </form>
        </DrawerBody>
        <DrawerFooter>
          <Button
            type="button"
            size="large"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={submitting}
            className="w-full"
          >
            Continue
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </VaulDrawer.NestedRoot>
  )
}
