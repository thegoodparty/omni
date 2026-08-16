'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button, Card } from '@styleguide'
import { MessageSquareIcon } from '@styleguide/components/ui/icons'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  TCR_COMPLIANCE_STATUS,
  getTcrCompliance,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import {
  CV_PIN_GATE,
  useCvPinGate,
} from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'
import ComplianceCardArt from './ComplianceCardArt'
import ProUpgrade3PinEntry from './ProUpgrade3PinEntry'
import TextingComplianceApproved from './TextingComplianceApproved'
import TextingComplianceDenied from './TextingComplianceDenied'
import TextingComplianceInReview from './TextingComplianceInReview'

// Post-payment compliance surface for the Pro-upgrade flow. The agent
// provisions the domain/site and submits TCR to Peerly after payment; this
// card only reflects the TCR record's status, it does not drive the agent.
const LoadingShell = (): React.JSX.Element => (
  <Card
    className="relative mt-4 overflow-hidden p-4 md:p-6"
    id="texting-compliance"
  >
    <div className="flex flex-col gap-2 pr-24">
      <div className="h-6 w-2/3 animate-pulse rounded-md bg-slate-200" />
      <div className="h-4 w-full animate-pulse rounded-md bg-slate-200" />
    </div>
  </Card>
)

export default function ProUpgrade3Compliance(): React.JSX.Element {
  const { data: tcrCompliance, isPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
  })

  const pinGate = useCvPinGate(tcrCompliance, { isTcrPending: isPending })

  // Hold a placeholder shell while loading so we don't flash the neutral
  // fallback to a candidate who is actually awaiting-PIN / in review / etc.
  if (isPending) {
    return <LoadingShell />
  }

  if (tcrCompliance) {
    switch (tcrCompliance.status) {
      case TCR_COMPLIANCE_STATUS.SUBMITTED: {
        // While the CV status is still loading, hold the shell rather than
        // flash the wrong surface.
        if (pinGate.state === CV_PIN_GATE.LOADING) {
          return <LoadingShell />
        }
        return pinGate.state === CV_PIN_GATE.READY ? (
          <ProUpgrade3PinEntry
            tcrCompliance={tcrCompliance}
            pinDelivery={pinGate.pinDelivery}
          />
        ) : (
          <TextingComplianceInReview
            title="Your registration is being verified"
            description="We’ll email you as soon as your PIN is ready to enter. This can take a few business days."
          />
        )
      }
      case TCR_COMPLIANCE_STATUS.PENDING:
        return (
          <TextingComplianceInReview
            title="Your candidate profile is being reviewed"
            description="Review takes 3-7 business days. We’ll email you when you’re ready to send texts."
          />
        )
      case TCR_COMPLIANCE_STATUS.APPROVED:
        return (
          <TextingComplianceApproved title="Your profile has been approved!" />
        )
      case TCR_COMPLIANCE_STATUS.REJECTED:
        return <TextingComplianceDenied />
    }
  }

  // No TCR record yet, or a retryable `error`/unknown status. A candidate who
  // came through the agentic purchase wizard has a record created pre-payment,
  // so this branch is reached by an already-Pro candidate who never went
  // through it (e.g. a legacy Pro upgrade) — for them nothing kicks off the
  // flow. Offer the election-filing form: it calls createAgentic (which kicks
  // off the agent for an already-Pro campaign and recreates a failed record)
  // and works without a pre-existing website, so it's the right entry here.
  return (
    <Card
      className="relative mt-4 overflow-hidden p-4 md:p-6"
      id="texting-compliance"
    >
      <div className="relative z-10 flex flex-col items-start gap-3 pr-24">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">Set up texting compliance</p>
          <p className="text-sm text-muted-foreground">
            Register your campaign for 10DLC texting compliance so you can send
            text messages to voters.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/profile/texting-compliance/election-filing">
            Get started
          </Link>
        </Button>
      </div>
      <ComplianceCardArt
        swooshColorClassName="bg-blue-100"
        icon={
          <MessageSquareIcon className="h-14 w-14 text-blue-600" aria-hidden />
        }
      />
    </Card>
  )
}
