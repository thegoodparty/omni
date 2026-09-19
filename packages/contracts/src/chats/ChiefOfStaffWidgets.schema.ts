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
