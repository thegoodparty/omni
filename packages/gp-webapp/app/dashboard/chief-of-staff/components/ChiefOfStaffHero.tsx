'use client'

import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { useUser } from '@shared/hooks/useUser'
import { useDashboardCards } from '../data/use-dashboard'

const parse = (iso: string): Date | null => {
  try {
    const date = parseISO(iso)
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

// The soonest due date among the active cards, phrased relatively when it is
// close enough for that to be the more useful reading.
const nextDueLabel = (dueDates: Date[]): string | null => {
  if (dueDates.length === 0) return null
  const soonest = dueDates.reduce((a, b) => (a < b ? a : b))
  const days = differenceInCalendarDays(soonest, new Date())
  if (days < 0) return null
  if (days === 0) return 'the first due today'
  if (days === 1) return 'the first due tomorrow'
  if (days <= 6) return `the first due ${format(soonest, 'EEEE')}`
  return `the first due ${format(soonest, 'MMMM d')}`
}

/**
 * The returning official's hero: a gradient headline plus one line of
 * orientation. Concrete numbers only — a clause whose data has not arrived is
 * dropped rather than filled with a placeholder, so the line is never wrong.
 *
 * Deliberately does NOT use the support estimate. That number only covers
 * about half of offices, which is why `SupportHero` is switched off on the card
 * home; a hero is the last place to put a figure that is often missing.
 *
 * This is also the greeting. The home opens a new conversation each session and
 * nothing is created until the official sends, so there is no server-seeded
 * greeting for it to duplicate.
 */
export default function ChiefOfStaffHero(): React.JSX.Element {
  const [user] = useUser()
  const { data: cards } = useDashboardCards('active')

  const count = cards?.length ?? 0
  const dueDates = (cards ?? [])
    .map((card) => parse(card.dueDate))
    .filter((date): date is Date => date !== null)
  const nextDue = nextDueLabel(dueDates)

  const orientation =
    count > 0
      ? `${count} ${count === 1 ? 'thing' : 'things'} prioritized this week${
          nextDue ? `, ${nextDue}` : ''
        }. `
      : ''

  return (
    <div className="flex flex-col gap-2.5 pb-3 pt-2 text-center">
      <h1 className="bg-gradient-to-r from-brand-red-400 to-brand-blue-400 bg-clip-text text-[30px] font-bold leading-[1.15] text-transparent">
        {user?.firstName
          ? `Let's pick up where you left off, ${user.firstName}.`
          : "Let's pick up where you left off."}
      </h1>
      <p className="text-base leading-[1.55] text-muted-foreground">
        {orientation}I keep your briefings, your priorities, and your district
        in one place.
      </p>
    </div>
  )
}
