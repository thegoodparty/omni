'use client'

import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'

// The campaign week the candidate is in, taken from the latest generation of
// dynamic tracker tasks — the product's own notion of "this week", so the hero
// and the tracker can't disagree. Null until the first CAP run has landed.
const currentWeek = (tasks: { week: number; isDefaultTask: boolean }[]) => {
  const dynamic = tasks.filter((t) => !t.isDefaultTask)
  return dynamic.length > 0 ? Math.max(...dynamic.map((t) => t.week)) : null
}

const daysToElection = (electionDate?: string | null): number | null => {
  if (!electionDate) return null
  const days = differenceInCalendarDays(
    parseISO(electionDate.slice(0, 10)),
    new Date(),
  )
  return days >= 0 ? days : null
}

/**
 * The returning candidate's hero: a gradient headline plus one line of
 * orientation (where they are in the campaign, how long is left, and what the
 * manager is holding for them). Concrete numbers only — a clause whose data has
 * not arrived is dropped rather than filled with a placeholder, so the line is
 * never wrong.
 *
 * Not shown to a first-time candidate: they get the tour instead, and a "62
 * days to election" headline is the wrong first thing to say to someone who has
 * not told us anything yet.
 */
export default function CampaignManagerHero(): React.JSX.Element {
  const [user] = useUser()
  const [campaign] = useCampaign()
  const { tasks } = useTrackerTasks()

  const week = currentWeek(tasks)
  const days = daysToElection(campaign?.details?.electionDate)

  const orientation = [
    week !== null ? `Week ${week} of your campaign` : null,
    days !== null
      ? `${days.toLocaleString('en-US')} ${days === 1 ? 'day' : 'days'} to election day`
      : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-2.5 pb-3 pt-2 text-center">
      <h1 className="bg-gradient-to-r from-brand-red-400 to-brand-blue-400 bg-clip-text text-[30px] font-bold leading-[1.15] text-transparent">
        {user?.firstName
          ? `Let's pick up where you left off, ${user.firstName}.`
          : "Let's pick up where you left off."}
      </h1>
      <p className="text-base leading-[1.55] text-muted-foreground">
        {orientation.length > 0 && `${orientation.join(', ')}. `}I keep your
        plan, your outreach, and your voter data in one place.
      </p>
    </div>
  )
}
