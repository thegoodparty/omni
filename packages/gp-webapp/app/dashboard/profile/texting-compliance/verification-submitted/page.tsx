import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle, Button, Card } from '@styleguide'
import {
  CheckCircleIcon,
  CheckIcon,
  InfoIcon,
} from '@styleguide/components/ui/icons'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { TakeoverShell } from 'app/dashboard/shared/takeover/TakeoverShell'
import { VerificationBadge } from 'app/dashboard/shared/takeover/VerificationBadge'
import { SUBMIT_PIN_PATH } from 'app/dashboard/shared/complianceRoute'

const meta = pageMetaData({
  title: 'Verification submitted | GoodParty.org',
  description: 'Your campaign has been submitted for verification.',
})
export const metadata = meta

// The design's verification "pending" screen (voter outreach 2.0): the
// election-filing form used to bounce straight to /dashboard/account with
// only a snackbar, leaving no confirmation of what was submitted or when
// the PIN arrives. Statically rendered: the filing submit that lands here
// is the only entry, so no compliance-state read is needed. The PIN shortcut
// button is for the retry case — a candidate who already received a PIN and
// is resubmitting lands here with one in hand; submit-pin's own gate refuses
// anyone whose PIN hasn't actually been issued.
export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  return (
    <TakeoverShell
      eyebrow="Verify campaign"
      progressValue={100}
      closeHref="/dashboard"
      footer={
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:justify-center">
          <Button
            asChild
            size="large"
            className="w-full lg:w-auto lg:min-w-[240px]"
          >
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <VerificationBadge />

        <Card className="items-center gap-3 p-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success-light">
            <CheckCircleIcon className="size-8 text-success" />
          </span>
          <h1 className="text-2xl font-semibold text-foreground">
            Submitted for verification
          </h1>
          <p className="text-muted-foreground">
            Your campaign has been submitted for verification.
          </p>
        </Card>

        <Alert variant="info" icon={<InfoIcon className="size-4" />}>
          <AlertTitle>A PIN is on its way</AlertTitle>
          <AlertDescription>
            After your campaign is verified, a PIN will be sent to the email,
            phone, or address that matches your election filing — about 1 to 2
            weeks. Entering the PIN unlocks texting.
          </AlertDescription>
        </Alert>

        <Button asChild variant="outline" size="large" className="w-full">
          <Link href={SUBMIT_PIN_PATH}>
            <CheckIcon className="size-4" /> I received my PIN, verify now
          </Link>
        </Button>
      </div>
    </TakeoverShell>
  )
}
