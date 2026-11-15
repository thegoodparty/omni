import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button, CircleCheckIcon } from '@styleguide'
import { OutreachFlowShell } from 'app/dashboard/outreach/v2/OutreachFlowShell'
import { uploadDetailPath, getImportContactsCopy } from './importContactsCopy'
import { useImportContactsSteps } from './useImportContactsSteps'

interface ImportContactsWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isWin: boolean
}

// The outreach flows' full-screen shell and stepper, for a CSV of people: the
// file, which column holds each detail, then a name and the consent box.
export default function ImportContactsWizard({
  open,
  onOpenChange,
  isWin,
}: ImportContactsWizardProps) {
  const COPY = getImportContactsCopy(isWin)
  const router = useRouter()
  const pathname = usePathname()
  const steps = useImportContactsSteps({ open, isWin })

  const uploadedId = steps.uploaded?.id ?? null
  // Stays open on the success screen until the import's page is the route,
  // so the page it was opened from never shows in between.
  useEffect(() => {
    if (uploadedId !== null && pathname === uploadDetailPath(uploadedId)) {
      onOpenChange(false)
    }
  }, [uploadedId, pathname, onOpenChange])

  const handleClose = () => {
    if (steps.isSending) return
    steps.trackAbandoned()
    onOpenChange(false)
  }

  const finished = steps.isSending || uploadedId !== null

  return (
    <OutreachFlowShell
      open={open}
      onClose={handleClose}
      title={COPY.wizard.title}
      headerBadge={COPY.wizard.title}
      currentStep={finished ? 0 : steps.stepIndex + 1}
      totalSteps={finished ? 0 : steps.totalSteps}
      onBack={steps.back}
      cta={steps.cta}
      dirty={steps.dirty}
    >
      {uploadedId !== null ? (
        // The outreach flows' success screen (SocialFlow, PollFlow, door
        // knocking's CreateCampaignSuccess): no card, at the top of the body.
        <div className="space-y-6 py-8 text-center">
          <div className="flex justify-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
              <CircleCheckIcon className="size-8 text-primary" />
            </span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">
              {COPY.wizard.uploadedTitle}
            </h2>
            <p className="text-muted-foreground">{COPY.wizard.uploadedLine}</p>
          </div>
          <div className="flex justify-center">
            <Button onClick={() => router.push(uploadDetailPath(uploadedId))}>
              {COPY.wizard.seeImport}
            </Button>
          </div>
        </div>
      ) : (
        steps.body
      )}
    </OutreachFlowShell>
  )
}
