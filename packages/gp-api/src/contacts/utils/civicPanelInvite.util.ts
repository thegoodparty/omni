import {
  MAX_LIST_SAMPLE_SIZE,
  PANEL_SEED_ASSUMED_JOIN_RATE,
  type CivicPanelBuildChannel,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import type { PanelSteering } from './civicPanelSteering.util'

// What a civic panel invite draws and how it sizes a text, shared by the
// build plan and the managed panel's waves. See the contacts AGENTS.md,
// "Sampling (prepare)" and "Managed civic panel".

// How many asks it takes to expect `joins` yeses. Rounded to six places
// first so float noise (94.5 / 0.03 = 3150.0000000000005) never asks one
// more person than the math says.
export const asksFor = (joins: number, rate: number) =>
  Math.ceil(Number((joins / rate).toFixed(6)))

// The residents a text invites to bring in `gap` members at the cold join
// rate, capped at the cell phones it can reach and the largest sample a
// list holds.
export const textInviteSize = (gap: number, reachable: number): number =>
  gap <= 0
    ? 0
    : Math.min(
        asksFor(gap, PANEL_SEED_ASSUMED_JOIN_RATE),
        reachable,
        MAX_LIST_SAMPLE_SIZE,
      )

// Every invite list draws people never invited to the panel and not
// reached in the rest window; the channel adds the reach it needs.
export const NOT_YET_ASKED = {
  civicPanelNeverInvited: true,
  notContactedRecently: true,
} as const

export const civicPanelInviteCriteria = (channel: CivicPanelBuildChannel) =>
  channel === 'text'
    ? { ...NOT_YET_ASKED, hasCellPhone: true }
    : channel === 'phone_banking'
      ? { ...NOT_YET_ASKED, hasAnyPhone: true }
      : { ...NOT_YET_ASKED }

const LIST_NAMES: Record<CivicPanelBuildChannel, string> = {
  text: 'Civic panel invite',
  phone_banking: 'Civic panel calls',
  door_knocking: 'Civic panel doors',
}

export const civicPanelInviteListName = ({
  channel,
  position,
  wave,
}: {
  channel: CivicPanelBuildChannel
  position: number
  wave: number
}): string => {
  const area = position > 1 ? ` ${position}` : ''
  const batch = wave > 1 ? `, batch ${wave}` : ''
  return `${LIST_NAMES[channel]}${area}${batch}`
}

// What a draw on this channel leans toward with the panel as it stands.
// Doors lean only once their tract is known to hold enough doors, at the
// draw; calls lean only once they stop putting landlines first.
export const inviteLean = (
  channel: CivicPanelBuildChannel,
  steering: PanelSteering,
): UnderrepresentedGroup | null => {
  if (channel === 'door_knocking') {
    return steering.doorTract ? 'unreachedAreas' : null
  }
  if (!steering.weights) return null
  if (channel === 'phone_banking') {
    return steering.landlineFirst ? null : steering.leansToward
  }
  return steering.leansToward
}
