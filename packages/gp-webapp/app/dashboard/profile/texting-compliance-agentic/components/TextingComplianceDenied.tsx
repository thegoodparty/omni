import { Card } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import ComplianceCardArt from './ComplianceCardArt'

const SUPPORT_EMAIL = 'campaignsuccess@goodparty.org'

export default function TextingComplianceDenied(): React.JSX.Element {
  return (
    <Card
      className="relative mt-4 overflow-hidden p-4 md:p-6"
      id="texting-compliance"
    >
      <div className="relative z-10 flex flex-col gap-1 pr-24">
        <p className="text-lg font-semibold">
          Your profile needs updates before sending texts
        </p>
        <p className="text-sm text-muted-foreground">
          Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600">
            {SUPPORT_EMAIL}
          </a>{' '}
          and we’ll help you fix the issues.
        </p>
      </div>
      <ComplianceCardArt
        swooshColorClassName="bg-error-100"
        icon={
          <CircleAlertIcon className="h-14 w-14 text-red-600" aria-hidden />
        }
      />
    </Card>
  )
}
