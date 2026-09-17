import Link from 'next/link'
import { Button, Card } from '@styleguide'
import { BadgeCheckIcon } from '@styleguide/components/ui/icons'
import ComplianceCardArt from './ComplianceCardArt'

interface TextingComplianceApprovedProps {
  title?: string
  description?: string
}

export default function TextingComplianceApproved({
  title = 'Your campaign is compliant',
  description = 'Schedule your introduction text message to voters today.',
}: TextingComplianceApprovedProps = {}): React.JSX.Element {
  return (
    <Card
      className="relative mt-4 overflow-hidden p-4 md:p-6"
      id="texting-compliance"
    >
      <div className="relative z-10 flex flex-col items-start gap-3 pr-24">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/outreach">Schedule</Link>
        </Button>
      </div>
      <ComplianceCardArt
        swooshColorClassName="bg-success-100"
        icon={
          <BadgeCheckIcon className="h-14 w-14 text-green-600" aria-hidden />
        }
      />
    </Card>
  )
}
