import {
  cityFromDistrictName,
  cityNameCase,
  type ManagedCivicPanel,
  type ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'

// The place a district serves, the way Serve copy names it ("Maplewood"),
// or null where the district is not known.
export const servePlaceOf = (
  l2Name: string | null | undefined,
): string | null => {
  const city = l2Name ? cityFromDistrictName(l2Name) : null
  return city ? cityNameCase(city) : null
}

export const useServePlace = (): string | null =>
  servePlaceOf(useOrganization()?.district?.l2Name)

const residentsOf = (place: string | null): string =>
  place ? `${place} residents` : 'residents of your district'

// Every string GoodParty's managed civic panel shows on the Serve home and
// in the Chief of Staff chat. Serve only, so constituents and residents.
export const MANAGED_PANEL_COPY = {
  headline: 'Your civic panel',
  seatsLabel: (place: string | null) =>
    `A civic panel filling up with residents from every part of ${place ?? 'your district'}`,
  offerQuestion: 'Want to see the invite?',
  notNow: 'Not now',
  inviteCardTitle: 'Your civic panel invite',
  inviteCardSubtitle: (place: string | null) => `Text to ${residentsOf(place)}`,
  reviewInvite: 'Review the invite',
  // The Who gets the mic video on the answer to How does it work?. Its text
  // alternative is the video's own on-screen lines.
  video: {
    label: 'Who gets the mic, a 1 minute video',
    textAlternative:
      "What the video says: You represent every resident in the district. Public comment speakers skew older (median age 61 vs 50 for their neighbors). And they don't reflect the whole community. Residents who reflect the whole district. Your civic panel is your community pulse.",
  },
  panelCardTitle: 'Your civic panel',
  panelCardStatus: (
    status: ManagedCivicPanelStatus,
    members: number,
    goal: number,
  ): string => {
    if (status === 'ready') return `Ready, ${members} members`
    if (status === 'stopped') return 'Stopped'
    const label =
      status === 'paused'
        ? 'Paused'
        : status === 'exhausted'
          ? 'Needs more residents'
          : 'Building'
    return `${label}, ${members} of ${goal} members`
  },
  // The progress cards on the Serve home: their headline over the deck.
  progressHeadline: 'Your civic panel',
  // The panel page's Invites card for the panel GoodParty builds.
  controls: {
    title: 'Invites',
    status: (status: ManagedCivicPanelStatus): string => {
      if (status === 'paused') {
        return 'Invites are paused. Nobody new gets one until you resume.'
      }
      if (status === 'ready') {
        return 'Your civic panel is full. No new invites are going out.'
      }
      if (status === 'exhausted') {
        return "We've invited everyone we can reach by text."
      }
      return "We're sending invites in your name."
    },
    nextInvites: 'Next invites',
    readyAround: 'Ready around',
    weekOf: (day: string) => `Week of ${day}`,
    pause: 'Pause invites',
    resume: 'Resume invites',
    error: "We couldn't change your civic panel. Try again.",
  },
  flow: {
    header: 'Civic panel invite',
    title: 'Does this invite sound like you?',
    caption: (place: string | null) =>
      `It goes to ${residentsOf(place)} in your name. We send it and handle every reply.`,
    // Pressing submit is the official's approval, so the line above it says
    // what they are agreeing to.
    agreement: (place: string | null) =>
      `We'll text this invite to ${residentsOf(place)} in your name.`,
    submit: 'Approve and send in my name',
    error: "We couldn't set up your civic panel. Try again.",
  },
} as const

// A yyyy-MM-dd day as the calendar day it names, wherever the reader is.
const calendarDay = (day: string): Date => new Date(`${day}T00:00:00`)

// The day the next invites go out: the next wave once one has gone, else
// the first. Null when none is due (paused, ready, exhausted).
export const managedPanelNextInvitesAt = (
  panel: ManagedCivicPanel,
): Date | null => {
  if (panel.status !== 'building') return null
  const { nextWaveAt, wavesSent, firstSendDate } = panel.progress
  if (nextWaveAt) return new Date(nextWaveAt)
  return wavesSent === 0 ? calendarDay(firstSendDate) : null
}

// The Monday of the week the panel should be ready, while that week is
// still ahead or under way.
export const managedPanelReadyWeek = (
  panel: ManagedCivicPanel,
  now: Date = new Date(),
): Date | null => {
  if (panel.status !== 'building') return null
  const monday = calendarDay(panel.progress.readyWeekOf)
  const weekEnds = new Date(monday)
  weekEnds.setDate(weekEnds.getDate() + 7)
  return weekEnds > now ? monday : null
}

// "Wednesday, November 4".
export const longDay = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

// "Wed, Nov 4".
export const shortDay = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

// "Nov 9".
export const monthDay = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
