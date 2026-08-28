'use client'

import Modal from '@shared/utils/Modal'
import H1 from '@shared/typography/H1'
import Body2 from '@shared/typography/Body2'
import { Button } from '@styleguide'
import Link from 'next/link'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrComplianceStatus } from 'helpers/types'

// Paths + the status-aware route decision live in the plain (server-safe)
// complianceRoute module; re-exported here for existing importers.
import {
  SUBMIT_PIN_PATH,
  ELECTION_FILING_PATH,
} from 'app/dashboard/shared/complianceRoute'

export { SUBMIT_PIN_PATH, ELECTION_FILING_PATH }

interface ComplianceModalProps {
  open: boolean
  tcrComplianceStatus?: TcrComplianceStatus | null
  // True when the registration is approved but CampaignVerify is not yet
  // VERIFIED — the carriers would hold every send, so scheduling is gated
  // until verification finishes (product decision 2026-08-28; supersedes the
  // schedule-then-hold "Needs compliance" model for new sends).
  cvUnverified?: boolean
  onClose: () => void
}

export function ComplianceModal({
  open,
  tcrComplianceStatus,
  cvUnverified = false,
  onClose,
}: ComplianceModalProps): React.JSX.Element {
  const helpTrailer = (
    <>
      <br />
      <br />
      Have questions? Visit{' '}
      <a
        href="https://support.goodparty.org/help-center/getting-text-compliant"
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline"
      >
        our help center
      </a>{' '}
      for more information or send us an email at{' '}
      <a href="mailto:campaignsuccess@goodparty.org" className="underline">
        campaignsuccess@goodparty.org
      </a>
    </>
  )

  let title: string,
    description: string | React.ReactNode,
    cta: string,
    ctaHref: string | undefined

  if (tcrComplianceStatus === TCR_COMPLIANCE_STATUS.APPROVED && cvUnverified) {
    return (
      <ApprovedUnverifiedModal
        open={open}
        onClose={onClose}
        helpTrailer={helpTrailer}
      />
    )
  }

  switch (tcrComplianceStatus) {
    case TCR_COMPLIANCE_STATUS.SUBMITTED:
      title = 'Submit your PIN to finish texting registration'
      description = (
        <>
          Your registration is in. To verify your identity, CampaignVerify will
          send a PIN within 2-3 business days to the email, phone, or address
          that matches your election filing. Enter it here to finish and start
          texting.
          {helpTrailer}
        </>
      )
      cta = 'Enter PIN'
      ctaHref = SUBMIT_PIN_PATH
      break
    case TCR_COMPLIANCE_STATUS.PENDING:
      title = 'Texting registration under review'
      description =
        'Your 10DLC registration is being reviewed and cannot send text messages yet. This typically takes 3-7 business days. We will email you once approved.'
      cta = 'Got it'
      ctaHref = undefined
      break
    case TCR_COMPLIANCE_STATUS.REJECTED:
      title = 'Texting registration needs attention'
      description =
        'Your 10DLC registration was rejected. Please contact our support team to resolve the issues and complete your registration.'
      cta = 'Contact Support'
      ctaHref = 'mailto:support@goodparty.org'
      break
    case TCR_COMPLIANCE_STATUS.ERROR:
      title = 'Registration error'
      description =
        'There was an error with your 10DLC registration. Please contact our support team for assistance.'
      cta = 'Contact Support'
      ctaHref = 'mailto:support@goodparty.org'
      break
    default:
      title = 'Action required: register for texting compliance'
      description = (
        <>
          Carrier requirements mean you must register before sending your first
          text. You&apos;ll need your Campaign EIN and your official filing
          link. Ready? Click Start Your Registration to get started.
          {helpTrailer}
        </>
      )
      cta = 'Start Registration'
      ctaHref = ELECTION_FILING_PATH
      break
  }

  return (
    <Modal
      open={open}
      closeCallback={onClose}
      preventBackdropClose
      preventEscClose
    >
      <div className="p-0 sm:p-2 md:p-8">
        <H1 className="m-0 sm:whitespace-nowrap">{title}</H1>
        <Body2 className="my-4">{description}</Body2>
        <div className="flex justify-between gap-4 mt-8">
          <Button size="large" variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          {ctaHref ? (
            ctaHref.startsWith('mailto:') ? (
              <Button asChild size="large">
                <a href={ctaHref}>{cta}</a>
              </Button>
            ) : (
              <Button asChild size="large">
                <Link href={ctaHref}>{cta}</Link>
              </Button>
            )
          ) : (
            <Button size="large" onClick={onClose}>
              {cta}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// Registration approved, CampaignVerify not VERIFIED: the send would be held
// by the carriers, so the gate blocks scheduling and points at the
// verification entry (election-filing, which starts the CampaignVerify leg).
const ApprovedUnverifiedModal = ({
  open,
  onClose,
  helpTrailer,
}: {
  open: boolean
  onClose: () => void
  helpTrailer: React.ReactNode
}): React.JSX.Element => (
  <Modal
    open={open}
    closeCallback={onClose}
    preventBackdropClose
    preventEscClose
  >
    <div className="p-0 sm:p-2 md:p-8">
      <H1 className="m-0 sm:whitespace-nowrap">
        Verify your campaign to start texting
      </H1>
      <Body2 className="my-4">
        Your texting registration is approved. One step remains: carriers
        require campaign verification before your texts can send. Start
        verification to finish setup — a PIN will be sent to the contact on your
        election filing.
        {helpTrailer}
      </Body2>
      <div className="flex justify-between gap-4 mt-8">
        <Button size="large" variant="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button asChild size="large">
          <Link href={ELECTION_FILING_PATH}>Start Verification</Link>
        </Button>
      </div>
    </div>
  </Modal>
)
