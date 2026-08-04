'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Textarea,
} from '@styleguide'
import { useIsMobile } from '@styleguide/hooks/use-mobile'
import { reportErrorToSentry } from '@shared/sentry'

// Matches the contract's bugReportDescriptionSchema max so an over-long
// description is stopped at the textarea instead of failing the POST.
const MAX_DESCRIPTION_LENGTH = 4_000

type Props = {
  open: boolean
  // The passage the user highlighted before opening the sheet.
  excerpt: string
  onClose: () => void
  onSubmit: (description: string) => Promise<void>
}

/**
 * Right-side sheet (bottom on mobile) for flagging a bug on the draft. Mirrors
 * the briefings report flow, but standalone: it shows the highlighted passage,
 * takes a description, and submits a bug_report. No positional highlight is
 * persisted — the draft is editable, so the passage is captured as text.
 */
export default function OrdinanceBugReportSheet({
  open,
  excerpt,
  onClose,
  onSubmit,
}: Props): React.JSX.Element {
  const isDesktop = !useIsMobile()
  const direction = isDesktop ? 'right' : 'bottom'

  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Reset the form each time the sheet opens so a prior draft doesn't linger.
  useEffect(() => {
    if (open) {
      setDescription('')
      setErrorMessage(null)
    }
  }, [open])

  const canSubmit = description.trim().length > 0 && !saving

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    setErrorMessage(null)
    try {
      await onSubmit(description.trim())
      onClose()
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'ordinance-annotations',
        op: 'createBugReport',
      })
      setErrorMessage("Couldn't submit. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => (v ? null : onClose())}
      direction={direction}
    >
      <DrawerContent className="flex flex-col gap-0 p-0 data-[vaul-drawer-direction=right]:sm:max-w-[480px]">
        <DrawerHeader className="gap-2 border-b border-border px-6 pb-4 pr-12 pt-6">
          <DrawerTitle className="text-base font-semibold text-foreground">
            Flag a bug
          </DrawerTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Spot a problem with this passage? Describe it and your report will
            help us improve the draft.
          </p>
        </DrawerHeader>

        <div
          data-vaul-no-drag
          className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-4"
        >
          {excerpt ? (
            <blockquote className="max-h-32 overflow-y-auto border-l-2 border-destructive pl-3 text-sm italic text-muted-foreground">
              {excerpt}
            </blockquote>
          ) : null}

          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setErrorMessage(null)
            }}
            placeholder="Describe the problem…"
            rows={6}
            maxLength={MAX_DESCRIPTION_LENGTH}
            className="min-h-[160px] w-full resize-none rounded-2xl"
          />
        </div>

        <div
          data-vaul-no-drag
          className="flex flex-col gap-2 border-t border-border bg-background px-4 py-3 lg:border-t-0"
        >
          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full"
          >
            {saving ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
