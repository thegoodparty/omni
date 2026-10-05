'use client'

import { formatInTimeZone } from 'date-fns-tz'
import type { User } from 'helpers/types'
import { useCampaign } from '@shared/hooks/useCampaign'
import DashboardLayout, {
  type DashboardNavHeaderConfig,
} from '../../shared/DashboardLayout'
import { NAV_LABELS } from '../../shared/navLabels'
import CampaignPlanPage from './CampaignPlanPage'
import CampaignPlanElectionPassedGate from './CampaignPlanElectionPassedGate'

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Mirrors gp-api's guard: passed only when every stored date has passed, so a
// stale general with an upcoming primary stays live. Compare calendar dates in
// UTC, not the viewer's zone: the API judges against its own UTC clock, so a US
// browser on election-day evening would otherwise still show the plan while
// the API already refuses to generate. Election day itself counts as upcoming.
const electionHasPassed = (
  electionDate: string | undefined,
  primaryElectionDate: string | undefined,
): boolean => {
  const todayUtc = formatInTimeZone(new Date(), 'UTC', 'yyyy-MM-dd')
  const days = [electionDate, primaryElectionDate]
    .map((date) => (date ?? '').trim().slice(0, 10))
    .filter((day) => ISO_DATE_ONLY.test(day))
  return days.length > 0 && days.every((day) => day < todayUtc)
}

interface CampaignPlanRouterProps {
  initialUser: User | null
}

// Decides what the Campaign Plan tab shows. There is one decision left: a
// campaign whose election has passed. Everything else opens the plan.
//
// Nobody generates their own plan. Opening the tab IS the request, so
// rendering CampaignPlanPage fires the generation POST and streams sections in
// as they arrive. The old gate asked first, which only ever delayed a
// candidate who had already asked by navigating here — the spend it was meant
// to avoid belongs to candidates who never open the tab, and they never
// trigger generation either way.
//
// The campaign story is not required: a candidate without one gets a generic
// plan and tracker, the story is prompted on the plan itself, and finishing it
// regenerates the plan from their own answers.
const CampaignPlanRouter = ({
  initialUser,
}: CampaignPlanRouterProps): React.JSX.Element => {
  const [campaign] = useCampaign()
  const electionDate = campaign?.details?.electionDate
  const primaryElectionDate = campaign?.details?.primaryElectionDate

  // Icon + name are the sidebar tab's, so the title bar can't disagree with
  // the rail. Only the tracker hero puts a CTA in the bar (the passed-election
  // gate has none) — the bar tracks that itself, so the same config serves
  // both branches below.
  const navHeader: DashboardNavHeaderConfig = {
    icon: 'checklist',
    label: NAV_LABELS.campaignPlan,
  }

  // A returning candidate's campaign still carries last cycle's election until
  // they update their race. gp-api refuses to generate a plan for a past
  // electionDate (400), and a tracker for a finished race is meaningless, so
  // send them to fix the race first rather than auto-generating against it.
  if (electionHasPassed(electionDate, primaryElectionDate)) {
    return (
      <DashboardLayout navHeader={navHeader}>
        <CampaignPlanElectionPassedGate
          electionDate={electionDate ?? primaryElectionDate ?? ''}
        />
      </DashboardLayout>
    )
  }

  return <CampaignPlanPage initialUser={initialUser} navHeader={navHeader} />
}

export default CampaignPlanRouter
