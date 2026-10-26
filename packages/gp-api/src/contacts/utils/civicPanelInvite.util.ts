import {
  MAX_LIST_SAMPLE_SIZE,
  PANEL_SEED_ASSUMED_JOIN_RATE,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import type { PanelSteering } from './civicPanelSteering.util'

// What a managed civic panel wave draws and how it sizes its text. See the
// contacts AGENTS.md, "Managed civic panel".

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

// An invite draws people with a cell phone, never invited to the panel and
// not reached in the rest window.
export const CIVIC_PANEL_INVITE_CRITERIA = {
  civicPanelNeverInvited: true,
  notContactedRecently: true,
  hasCellPhone: true,
} as const

export const civicPanelInviteListName = (wave: number): string =>
  wave > 1 ? `Civic panel invite, batch ${wave}` : 'Civic panel invite'

// What a wave's draw leans toward with the panel as it stands.
export const inviteLean = (
  steering: PanelSteering,
): UnderrepresentedGroup | null =>
  steering.weights ? steering.leansToward : null
