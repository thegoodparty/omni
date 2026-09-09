'use client'

import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'

const toDate = (value?: Date | string | null): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : parseISO(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// Which week of the campaign the candidate is in, counted from when they
// started. Deliberately NOT the tracker's `week` column: that is a generation
// counter incremented on each weekly regen, so it read "Week 1" for a candidate
// eight weeks out from their election.
const campaignWeek = (createdAt?: Date | string | null): number | null => {
  const start = toDate(createdAt)
  if (!start) return null
  const days = differenceInCalendarDays(new Date(), start)
  if (days < 0) return null
  return Math.floor(days / 7) + 1
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
 * This is also the greeting. The home opens a new conversation each session and
 * nothing is created until the candidate sends, so there is no server-seeded
 * greeting on this surface for it to duplicate.
 */
export default function CampaignManagerHero(): React.JSX.Element {
  const [user] = useUser()
  const [campaign] = useCampaign()

  const week = campaignWeek(campaign?.createdAt)
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
