import { ShowListMapSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// A display tool, like the ordinance flow's present_* family: the args ARE
// the widget payload, and execute only acks. It deliberately does no work and
// reads nothing — the webapp fetches the list's members itself, so no person
// ever passes through the model's context on the way to the map.
//
// It is a separate call rather than something inferred from crud_saved_filters
// because a persisted chat segment stores a tool call's ARGS and not its
// result. The list id only exists in the create result, so a map keyed off
// that call would render once and then disappear on reload. Args persist, so
// this one replays.
export const buildShowListMapTool = (): LlmStreamTool<
  typeof ShowListMapSchema
> => ({
  description:
    'Show a saved list on a map in the conversation, as a card. Pass the ' +
    'list id returned by crud_saved_filters and the name you gave it. Call ' +
    'it right after creating or updating a list the user will want to see ' +
    'placed — a housing or neighbourhood segment, anything where WHERE ' +
    'people are is part of the answer — and do not describe the map in prose ' +
    'as well, the card speaks for itself. Do not call it for a list the user ' +
    'only asked to count, and never call it with an id you were not handed ' +
    'by crud_saved_filters.',
  inputSchema: ShowListMapSchema,
  execute: ({ listId }) => ({ shown: true, listId }),
})
