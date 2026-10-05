import { Card } from '@styleguide'
import { TimerIcon } from '@styleguide/components/ui/icons'
import ComplianceCardArt from './ComplianceCardArt'

interface TextingComplianceInReviewProps {
  title?: string
  description?: string
}

export default function TextingComplianceInReview({
  title = 'Your application is in review',
  description = 'This can take 3-7 business days. We will send you an email once your campaign is approved, so you can start sending text messages.',
}: TextingComplianceInReviewProps = {}): React.JSX.Element {
  return (
    <Card
      className="relative mt-4 overflow-hidden p-4 md:p-6"
      id="texting-compliance"
    >
      <div className="relative z-10 flex flex-col gap-1 pr-24">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ComplianceCardArt
        swooshColorClassName="bg-warning-100"
        icon={
          <TimerIcon
            className="h-14 w-14 text-brand-bright-yellow-600"
            aria-hidden
          />
        }
      />
    </Card>
  )
}
