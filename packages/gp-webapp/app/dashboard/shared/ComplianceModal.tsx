'use client'

import Modal from '@shared/utils/Modal'
import H1 from '@shared/typography/H1'
import Body2 from '@shared/typography/Body2'
import { Button } from '@styleguide'
import Link from 'next/link'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrCompliance } from 'helpers/types'

export const SUBMIT_PIN_PATH =
  '/dashboard/profile/texting-compliance/submit-pin'
// The registration form (not the pre-payment Pro-upgrade wizard). An
// already-Pro candidate with no TCR record routed into the wizard dead-ends on
// its SUCCESS surface and loops back to the dashboard (ENG-10441); the
// election-filing form calls createAgentic and is the correct entry for them,
// matching ProUpgrade3Compliance's no-record branch.
export const ELECTION_FILING_PATH =
  '/dashboard/profile/texting-compliance/election-filing'

interface ComplianceModalProps {
  open: boolean
  tcrCompliance?: Pick<
    TcrCompliance,
    'status' | 'peerlyIdentityId' | 'cvValidationFailedAt'
  > | null
  onClose: () => void
}

export function ComplianceModal({
  open,
  tcrCompliance,
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

  switch (tcrCompliance?.status) {
    case TCR_COMPLIANCE_STATUS.SUBMITTED:
      // `submitted` spans three states (ENG-11018): a PIN exists only once a
      // Peerly identity does, and a validation hold needs corrected filing
      // details, not a PIN.
      if (tcrCompliance?.peerlyIdentityId) {
        title = 'Submit your PIN to finish texting registration'
        description = (
          <>
            Your registration is in. To verify your identity, CampaignVerify
            will send a PIN within 2-3 business days to the email, phone, or
            address that matches your election filing. Enter it here to finish
            and start texting.
            {helpTrailer}
          </>
        )
        cta = 'Enter PIN'
        ctaHref = SUBMIT_PIN_PATH
      } else if (tcrCompliance?.cvValidationFailedAt) {
        title = 'Update your election filing link'
        description = (
          <>
            We couldn&apos;t confirm your candidacy from the filing link you
            gave us. Update your filing details with a link to your official
            election filing to keep your registration moving.
            {helpTrailer}
          </>
        )
        cta = 'Update Filing Details'
        ctaHref = ELECTION_FILING_PATH
      } else {
        title = 'Texting registration in progress'
        description = (
          <>
            We&apos;re setting up your texting registration. There&apos;s
            nothing you need to do right now. Check back soon.
            {helpTrailer}
          </>
        )
        cta = 'Got it'
        ctaHref = undefined
      }
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
