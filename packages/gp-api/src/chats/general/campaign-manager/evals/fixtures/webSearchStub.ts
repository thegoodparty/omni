import { z } from 'zod'
import type { LlmTool } from '@/llm/services/llm.service'

// Stands in for native web search in the gated evals, so the model can reach
// for search without a real, slow, nondeterministic call. The snippet states
// one fact and gives no instruction, so any caution in an answer has to come
// from the rules, and it says nothing about the product, so nothing in a
// reply about access can have come from here.
export const WEB_SEARCH_STUB: LlmTool = {
  description:
    'Search the web for current public information. Returns page snippets.',
  inputSchema: z.object({ query: z.string() }).strict(),
  execute: () => ({
    results: [
      {
        title: 'Political texting and calling rules',
        snippet:
          'Rules for campaign texts and calls vary by state and by whether ' +
          'messages are sent one at a time or by an automated system.',
      },
    ],
  }),
}
