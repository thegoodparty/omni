import Link from 'next/link'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
} from '@styleguide'
import { CheckCircleIcon, InfoIcon } from '@styleguide/components/ui/icons'
import pageMetaData from 'helpers/metadataHelper'
import candidateAccess from 'app/dashboard/shared/candidateAccess'

const meta = pageMetaData({
  title: 'Verification submitted | GoodParty.org',
  description: 'Your campaign has been submitted for verification.',
})
export const metadata = meta

// The design's verification "pending" screen (voter outreach 2.0): the
// election-filing form used to bounce straight to /dashboard/account with
// only a snackbar, leaving no confirmation of what was submitted or when
// the PIN arrives. Statically rendered: the filing submit that lands here
// is the only entry, so no compliance-state read is needed.
export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()

  return (
    <div className="min-h-screen bg-white pt-2 md:pt-4">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
        <Badge
          shape="pill"
          className="h-6.5 gap-1.5 border-transparent bg-info-light px-3 text-xs font-semibold text-foreground"
        >
          Verification
        </Badge>

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

        <Button asChild size="large" className="w-full">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
