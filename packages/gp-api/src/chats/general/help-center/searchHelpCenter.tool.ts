import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type {
  HelpCenterSearchResult,
  HelpCenterSearchService,
} from './helpCenterSearch.service'

const searchHelpCenterInputSchema = z
  .object({
    query: z
      .string()
      .min(2)
      .max(200)
      .describe(
        'What the user is trying to do, in a few words, the way a support ' +
          'article would title it. "send a text message", "texting ' +
          'compliance", "cancel my subscription".',
      ),
  })
  .strict()

// Read-only, unauthenticated, and scoped to our own published support
// articles. Returns titles, links, and summaries, never article bodies: the
// model gets enough to answer and to link the right page, and the user gets a
// URL they can read for the full steps.
export const buildSearchHelpCenterTool = (deps: {
  helpCenter: Pick<HelpCenterSearchService, 'search'>
}): LlmStreamTool<typeof searchHelpCenterInputSchema> => ({
  description:
    "Search GoodParty.org's help center for a support article. Use it for " +
    'how-to steps, texting and compliance rules, billing and Pro questions, ' +
    'and anything procedural that the product map does not answer. Returns ' +
    'the matching articles with a title, a link, a summary, and a category. ' +
    'Search before you hand anyone off to support.',
  inputSchema: searchHelpCenterInputSchema,
  execute: ({ query }): Promise<HelpCenterSearchResult> =>
    deps.helpCenter.search(query),
})
