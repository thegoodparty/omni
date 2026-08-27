'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@styleguide'
import {
  CalendarIcon,
  ClipboardListIcon,
  FileTextIcon,
  MapPinIcon,
  SendIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { clientRequest } from 'gpApi/typed-request'
import { useProUpgradeWizard } from './ProUpgradeWizard'
import WizardStepFooter from './WizardStepFooter'
import WizardHeading from './WizardHeading'

const FILING_INSTRUCTIONS_QUERY_KEY = ['filing-instructions']

interface InstructionRowProps {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}

const InstructionRow = ({
  icon,
  label,
  children,
}: InstructionRowProps): React.JSX.Element => (
  <div className="flex gap-3 border-t border-base-border p-4 first:border-t-0">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-400">
      {icon}
    </span>
    <div>
      <span className="block font-medium">{label}</span>
      <Body2 className="text-base-muted-foreground">{children}</Body2>
    </div>
  </div>
)

const FilingInstructionsStep = (): React.JSX.Element => {
  const router = useRouter()
  const { goToPreviousStep } = useProUpgradeWizard()
  const { errorSnackbar, successSnackbar } = useSnackbar()
  const [emailing, setEmailing] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsViewed)
  }, [])

  // Read the content from the server (not the cached campaign) so the screen
  // shows exactly what "email this to me" sends — both come from one source.
  const {
    data: content,
    isPending,
    isError,
  } = useQuery({
    queryKey: FILING_INSTRUCTIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await clientRequest(
        'GET /v1/campaigns/mine/filing-instructions',
        {},
      )
      return res.data
    },
  })

  // On fetch failure every field falls back to null, which renders identically
  // to a legitimate no-data race — tell the user it's an error, not the truth.
  useEffect(() => {
    if (isError) {
      errorSnackbar('Failed to load filing instructions. Please try again.')
    }
  }, [isError, errorSnackbar])

  const filingWindow = content?.filingWindow ?? null
  const filingFee = content?.filingFee ?? null
  const filingRequirementsText = content?.filingRequirementsText ?? null
  const filingOfficeAddress = content?.filingOfficeAddress ?? null
  const filingPhoneNumber = content?.filingPhoneNumber ?? null
  const paperworkInstructions = content?.paperworkInstructions ?? null

  // Compose fee + requirements into one "Filing requirements" detail, matching
  // the Figma ("Filing fee is $X. <requirements text>"). $-format matches
  // gp-api's email body (raw dollars) so the two surfaces report the same fee.
  const requirementsDetail = [
    filingFee != null ? `Filing fee is $${filingFee}.` : null,
    filingRequirementsText,
  ]
    .filter(Boolean)
    .join(' ')

  const hasOffice = Boolean(filingOfficeAddress || filingPhoneNumber)

  const handleEmail = async (): Promise<void> => {
    // Guard against a double-tap firing two sends.
    if (emailing) return
    setEmailing(true)
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsEmail)
    try {
      // No body: gp-api scopes the send to the caller's own campaign + email.
      await clientRequest(
        'POST /v1/campaigns/mine/filing-instructions/email',
        {},
      )
      successSnackbar('Filing instructions sent to your email.')
    } catch (e) {
      console.error('error emailing filing instructions', e)
      errorSnackbar('Something went wrong. Please try again.')
    } finally {
      setEmailing(false)
    }
  }

  const handleExit = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.FilingInstructionsExit)
    router.push('/dashboard')
  }

  return (
    <div>
      <WizardHeading
        proBadge
        title="You're not eligible for Pro yet, but here's how to file for this election"
        subtitle="Once done, you can come right back and we'll have everything ready to go. In the meantime, you still have access to our free campaign tools."
      />

      <div className="rounded-xl border border-base-border">
        <InstructionRow
          icon={<CalendarIcon className="h-5 w-5" />}
          label="Filing window"
        >
          {isPending ? 'Loading…' : (filingWindow ?? 'Not yet available')}
        </InstructionRow>

        {requirementsDetail && (
          <InstructionRow
            icon={<FileTextIcon className="h-5 w-5" />}
            label="Filing requirements"
          >
            {requirementsDetail}
          </InstructionRow>
        )}

        {paperworkInstructions && (
          <InstructionRow
            icon={<ClipboardListIcon className="h-5 w-5" />}
            label="Paperwork"
          >
            {paperworkInstructions}
          </InstructionRow>
        )}

        {hasOffice && (
          <InstructionRow
            icon={<MapPinIcon className="h-5 w-5" />}
            label="Filing office"
          >
            {filingOfficeAddress && (
              <span className="block">{filingOfficeAddress}</span>
            )}
            {filingPhoneNumber && (
              <span className="block">{filingPhoneNumber}</span>
            )}
          </InstructionRow>
        )}

        <div className="flex justify-center border-t border-base-border p-2">
          <Button
            variant="ghost"
            size="small"
            className="text-blue-400"
            onClick={() => void handleEmail()}
            loading={emailing}
            loadingText="Sending…"
            icon={<SendIcon className="h-4 w-4" />}
            iconPosition="right"
          >
            Email this to me
          </Button>
        </div>
      </div>

      <WizardStepFooter
        back={{ onClick: goToPreviousStep }}
        primary={{ label: 'Continue to dashboard', onClick: handleExit }}
      />
    </div>
  )
}

export default FilingInstructionsStep
