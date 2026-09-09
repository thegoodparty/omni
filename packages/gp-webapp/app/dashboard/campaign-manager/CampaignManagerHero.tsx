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
    week !== null ? `Week ${week}` : null,
    days !== null
      ? `${days.toLocaleString('en-US')} ${days === 1 ? 'day' : 'days'} to election`
      : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <h1 className="bg-gradient-to-r from-brand-red-400 to-brand-blue-400 bg-clip-text text-2xl font-semibold tracking-[-0.02em] text-transparent">
        {user?.firstName
          ? `Good to see you, ${user.firstName}.`
          : 'Good to see you.'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {orientation.length > 0 && `${orientation.join(', ')}. `}I keep track of
        your plan, your voters, and what is due next.
      </p>
    </div>
  )
}
