import Link from 'next/link'
import { Button, CalendarClockIcon, Card } from '@styleguide'
import { dateUsHelper } from 'helpers/dateHelper'

interface CampaignPlanElectionPassedGateProps {
  electionDate: string
}

// Shown in place of the plan/tracker when the campaign's election has already
// happened. The only way forward is updating the race, so this is a single CTA
// to the office editor rather than a disabled plan.
const CampaignPlanElectionPassedGate = ({
  electionDate,
}: CampaignPlanElectionPassedGateProps): React.JSX.Element => {
  // dateUsHelper parses with `new Date()`, which reads a date-only ISO string
  // as UTC midnight and can render a day early in western zones; the
  // slash-separated form parses as local midnight.
  const formatted = dateUsHelper(electionDate.slice(0, 10).replace(/-/g, '/'))
  return (
    <Card className="mx-auto flex max-w-2xl flex-col items-start gap-4 p-8">
      <CalendarClockIcon className="size-8 text-primary" />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Your election date has passed
        </h2>
        <p className="text-muted-foreground">
          This campaign is set up for an election on {formatted}. Update your
          race to the election you&apos;re running in now and we&apos;ll build
          your Campaign Plan and tracker around it.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard/campaign-details">Update my race</Link>
      </Button>
    </Card>
  )
}

export default CampaignPlanElectionPassedGate
