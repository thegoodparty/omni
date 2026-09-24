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

interface VerificationSubmittedContentProps {
  primaryAction?: React.ReactNode
}

const defaultPrimaryAction = (
  <Button asChild size="large" className="w-full">
    <Link href="/dashboard">Back to dashboard</Link>
  </Button>
)

export default function VerificationSubmittedContent({
  primaryAction = defaultPrimaryAction,
}: VerificationSubmittedContentProps): React.JSX.Element {
  return (
    <div className="space-y-6">
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
          phone, or address that matches your election filing, usually 1 to 2
          weeks. Entering the PIN unlocks texting.
        </AlertDescription>
      </Alert>

      {primaryAction}
    </div>
  )
}
