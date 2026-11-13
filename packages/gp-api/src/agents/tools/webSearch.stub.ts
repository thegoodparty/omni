import { z } from 'zod'
import type { AgentTool } from './tool'

const WebSearchInput = z.object({ query: z.string().min(1) })

export type ProviderWebSearchTool = AgentTool<typeof WebSearchInput> & {
  provider: 'anthropic_web_search'
  maxUses: number
}

export const webSearch: ProviderWebSearchTool = {
  name: 'web_search',
  description:
    'Search the public web. Returns result titles, URLs and snippets. Use fetchPage to read a result.',
  input: WebSearchInput,
  provider: 'anthropic_web_search',
  maxUses: 5,
  execute: async () => {
    throw new Error('web_search is a stub until the web tools land')
  },
}
