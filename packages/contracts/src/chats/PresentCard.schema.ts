import { z } from 'zod'
import {
  ConstituentRefSchema,
  OutsideContactSchema,
  PastOutreachRefSchema,
} from './ChatCard.schema'
import {
  ListProposalSchema,
  ShowListMapSchema,
} from './ChiefOfStaffWidgets.schema'
import {
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
} from '../ordinances/Ordinance.schema'

/**
 * The display-only cards an agent can show, as kinds of one `present_card`
 * tool. A card whose tool would only acknowledge its arguments is a kind
 * here, never a tool of its own: gp-api offers a surface's kinds and writes
 * their prompt text from this catalog, and the webapp renders each kind from
 * one component map. A tool whose execute does real work (persists, gates,
 * refuses on what it reads) stays a tool.
 *
 * Append only: a kind is persisted in the tool args of segments that already
 * exist.
 */
export const PRESENT_CARD_TOOL = 'present_card'

export const PresentCardSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('outside_contact'),
    ...OutsideContactSchema.shape,
  }),
  z.object({
    kind: z.literal('past_outreach'),
    ...PastOutreachRefSchema.shape,
  }),
  z.object({ kind: z.literal('constituents'), ...ConstituentRefSchema.shape }),
  z.object({ kind: z.literal('list_proposal'), ...ListProposalSchema.shape }),
  z.object({ kind: z.literal('list_map'), ...ShowListMapSchema.shape }),
  z.object({
    kind: z.literal('current_law_summary'),
    ...OrdinanceCurrentLawSummarySchema.shape,
  }),
  z.object({
    kind: z.literal('legislative_history'),
    ...OrdinanceLegislativeHistorySchema.shape,
  }),
])
export type PresentCard = z.infer<typeof PresentCardSchema>
export type PresentCardKind = PresentCard['kind']

export const PRESENT_CARD_DESCRIPTIONS: Record<PresentCardKind, string> = {
  outside_contact:
    "One person or office outside the user's records to contact about a " +
    'problem, with a script to use.',
  past_outreach:
    'One to five past sends worth a look, each opening its results.',
  constituents:
    "People already in the user's own contact records, by contact id.",
  list_proposal:
    'A counted list the user saves with its Create list button, which then ' +
    'becomes the list on a map.',
  list_map:
    'A saved list on a map, where the user can draw shapes to narrow it.',
  current_law_summary:
    'What the current code, statute or program does today and where it ' +
    'falls short.',
  legislative_history:
    'A timeline of how the current law was adopted and amended, and why.',
}

// The card sits under one key because a tool's input must be a top-level
// object for Anthropic, and a bare union converts to a top-level anyOf.
export const PresentCardInputSchema = z.object({ card: PresentCardSchema })
export type PresentCardInput = z.infer<typeof PresentCardInputSchema>

/** The variants a surface offers, in catalog order. */
export const pickPresentCardOptions = (kinds: readonly PresentCardKind[]) =>
  PresentCardSchema.options.filter((option) =>
    kinds.includes(option.shape.kind.value),
  )

/**
 * The tools each kind used to be. Persisted segments keep these names, so
 * the webapp still renders them and gp-api replays them to the model as the
 * `present_card` call they would be today.
 */
export const LEGACY_PRESENT_CARD_TOOLS = {
  present_outside_contact: 'outside_contact',
  present_past_outreach: 'past_outreach',
  present_constituents: 'constituents',
  present_contacts: 'constituents',
  present_list_proposal: 'list_proposal',
  show_list_map: 'list_map',
  present_current_law_summary: 'current_law_summary',
  present_legislative_history: 'legislative_history',
} as const satisfies Record<string, PresentCardKind>

export type LegacyPresentCardTool = keyof typeof LEGACY_PRESENT_CARD_TOOLS

export const isLegacyPresentCardTool = (
  toolName: string,
): toolName is LegacyPresentCardTool =>
  Object.hasOwn(LEGACY_PRESENT_CARD_TOOLS, toolName)
