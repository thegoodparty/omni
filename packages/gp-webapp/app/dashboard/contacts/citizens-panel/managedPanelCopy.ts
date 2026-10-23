import {
  cityFromDistrictName,
  cityNameCase,
  type ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'

// The place the office serves, the way Serve copy names it ("Maplewood"),
// or null where the district is not known.
export const useServePlace = (): string | null => {
  const l2Name = useOrganization()?.district?.l2Name
  const city = l2Name ? cityFromDistrictName(l2Name) : null
  return city ? cityNameCase(city) : null
}

const residentsOf = (place: string | null): string =>
  place ? `${place} residents` : 'residents of your district'

// Every string GoodParty's managed civic panel shows on the Serve home and
// in the Chief of Staff chat. Serve only, so constituents and residents.
export const MANAGED_PANEL_COPY = {
  headline: 'Every group gets a seat',
  seatsLabel: (filled: number) =>
    `${filled} of 100 seats filled, one for every group in your district`,
  offerQuestion: 'Want to see the invite?',
  notNow: 'Not now',
  inviteCardTitle: 'Your civic panel invite',
  inviteCardSubtitle: (place: string | null) => `Text to ${residentsOf(place)}`,
  reviewInvite: 'Review the invite',
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
  // The panel page's controls for the panel GoodParty builds.
  controls: {
    title: 'Your civic panel invites',
    status: (
      status: ManagedCivicPanelStatus,
      nextInvites: string | null,
    ): string => {
      if (status === 'paused') {
        return 'Invites are paused. Nobody new gets one until you resume.'
      }
      if (status === 'ready') return 'Your civic panel is ready.'
      if (status === 'exhausted') {
        return 'Every resident we can text has an invite.'
      }
      return nextInvites
        ? `We're sending invites. The next ones go out ${nextInvites}.`
        : "We're sending invites in your name."
    },
    pause: 'Pause invites',
    resume: 'Resume invites',
    stop: 'Stop my civic panel',
    stopTitle: 'Stop building your civic panel?',
    stopCaption:
      "We won't send any more invites. Everyone who joined stays on your civic panel.",
    stopConfirm: 'Stop my civic panel',
    stopCancel: 'Keep building',
    error: "We couldn't change your civic panel. Try again.",
  },
  flow: {
    header: 'Civic panel invite',
    title: 'Does this invite sound like you?',
    caption: (place: string | null) =>
      `It goes to ${residentsOf(place)} in your name. We send it and handle every reply.`,
    consent: 'I approve GoodParty sending this invite in my name.',
    submit: 'Set up my civic panel',
    error: "We couldn't set up your civic panel. Try again.",
  },
} as const

// "Tuesday, November 3", the day the next invites go out.
export const managedPanelNextInvites = (
  nextWaveAt: Date | string | null,
): string | null =>
  nextWaveAt
    ? new Date(nextWaveAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : null
