import {
  cityFromDistrictName,
  type ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'

// The place the office serves, the way Serve copy names it ("Maplewood"),
// or null where the district is not known.
export const useServePlace = (): string | null => {
  const l2Name = useOrganization()?.district?.l2Name
  return l2Name ? cityFromDistrictName(l2Name) : null
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
  whoGetsTexted: 'Who gets texted?',
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
    const label = status === 'paused' ? 'Paused' : 'Building'
    return `${label}, ${members} of ${goal} members`
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
