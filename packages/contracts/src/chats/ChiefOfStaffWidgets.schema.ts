import { z } from 'zod'

// The payload for the Chief of Staff's inline list map.
//
// It is the TOOL'S ARGUMENTS, not its result, and that is the whole point: a
// persisted chat segment stores a tool call's args and nothing else, so a
// widget whose payload lives in the result vanishes when the transcript is
// reloaded. Carrying the list id in the args is what lets the map replay.
// Same shape as the ordinance flow's present_* tools.
export const ShowListMapSchema = z.object({
  listId: z
    .number()
    .int()
    .positive()
    .describe(
      'Id of the saved list to map, as returned by crud_saved_filters.',
    ),
  // Carried so the card can title itself without a second fetch, and so a
  // renamed or deleted list still renders as the thing the conversation was
  // about rather than as an empty frame.
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("The saved list's name, for the card heading."),
})

export type ShowListMap = z.infer<typeof ShowListMapSchema>

// A list the agent has counted and wants the official to save, shown as a
// card with a Create list button instead of a prose "Ready to save it?".
// Args again, for the same reason: the card has to replay on reload, and the
// key it is created under is derived from the conversation and the tool call
// (`mintProposalKey`), so the browser can ask whether it already exists.
//
// `filters` is the filter the agent counted with, passed through to the
// list create untouched. It is validated against the voter-file filter
// schema by the tool on the way in and by the create route on the way out,
// so the card itself only needs to carry it.
export const ListProposalSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .describe('The list name, named after the filters it actually applies.'),
  summary: z
    .string()
    .min(1)
    .max(200)
    .describe('One plain sentence on who the list holds, for the card.'),
  count: z
    .number()
    .int()
    .nonnegative()
    .describe('The count count_contacts returned for these filters.'),
  filters: z
    .record(z.string(), z.json())
    .describe('The exact filter you counted with in count_contacts.'),
})

export type ListProposal = z.infer<typeof ListProposalSchema>
