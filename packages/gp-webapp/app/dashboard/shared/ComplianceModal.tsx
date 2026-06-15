'use client'

import Modal from '@shared/utils/Modal'
import H1 from '@shared/typography/H1'
import Body2 from '@shared/typography/Body2'
import { Button } from '@styleguide'
import Link from 'next/link'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrComplianceStatus } from 'helpers/types'
import { useProUpgradeFlag } from '@shared/experiments/proUpgradeFlag'
import {
  useProUpgrade3Flag,
  PRO_UPGRADE_ENTRY_PATH,
} from '@shared/experiments/proUpgrade3Flag'

const PROFILE_COMPLIANCE_PATH = '/dashboard/profile#texting-compliance'

interface ComplianceModalProps {
  open: boolean
  tcrComplianceStatus?: TcrComplianceStatus | null
  onClose: () => void
}

export function ComplianceModal({
  open,
  tcrComplianceStatus,
  onClose,
}: ComplianceModalProps): React.JSX.Element {
  const { ready, enabled } = useProUpgradeFlag()
  const phase1Enabled = ready && enabled

  // Only the default "Start Registration" branch links into the
  // compliance/upgrade flow. The pending/submitted/rejected/error statuses are
  // not registration prompts: pending/rejected/error use a mailto or no href,
  // and submitted (no dedicated case) falls through to the default branch, so
  // it must be excluded here to avoid mislabeling an already-submitted user as
  // needing to register.
  const isRegistrationCase =
    tcrComplianceStatus !== TCR_COMPLIANCE_STATUS.PENDING &&
    tcrComplianceStatus !== TCR_COMPLIANCE_STATUS.SUBMITTED &&
    tcrComplianceStatus !== TCR_COMPLIANCE_STATUS.REJECTED &&
    tcrComplianceStatus !== TCR_COMPLIANCE_STATUS.ERROR

  // The callers mount this modal unconditionally (open or not), so only count
  // experiment exposure when the registration CTA is actually rendered and on
  // screen.
  const { ready: proUpgrade3Ready, enabled: proUpgrade3Enabled } =
    useProUpgrade3Flag(open && isRegistrationCase)

  // pro-upgrade3 cohort enters the new wizard; the off cohort and the
  // not-yet-resolved window both keep the profile texting-compliance section
  // (routing through the wizard before the flag resolves would bounce an
  // off-cohort user to pro-sign-up, not back here).
  const registrationHref =
    isRegistrationCase && proUpgrade3Ready && proUpgrade3Enabled
      ? PRO_UPGRADE_ENTRY_PATH
      : PROFILE_COMPLIANCE_PATH

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

  switch (tcrComplianceStatus) {
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
          {phase1Enabled
            ? "Carrier requirements mean you must register before sending your first text. You'll need your Campaign EIN and your official filing link. Ready? Click Start Your Registration to get started."
            : "Carrier requirements mean you must register before sending your first text. You'll need your Campaign EIN, your official filing link, and an active website purchased through GoodParty.org. Don't have a site yet? You can build and launch one right from your dashboard before getting started."}
          {helpTrailer}
        </>
      )
      cta = 'Start Registration'
      ctaHref = registrationHref
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
          <Button size="large" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {ctaHref ? (
            ctaHref.startsWith('mailto:') ? (
              <Button asChild size="large" variant="secondary">
                <a href={ctaHref}>{cta}</a>
              </Button>
            ) : (
              <Button asChild size="large" variant="secondary">
                <Link href={ctaHref}>{cta}</Link>
              </Button>
            )
          ) : (
            <Button size="large" variant="secondary" onClick={onClose}>
              {cta}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
