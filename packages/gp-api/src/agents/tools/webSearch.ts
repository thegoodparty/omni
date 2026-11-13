import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import type { AgentTool } from './tool'

const WebSearchInput = z.object({ query: z.string().min(1) })

export type ProviderWebSearchTool = AgentTool<typeof WebSearchInput> & {
  provider: 'anthropic_web_search'
  maxUses: number
}

export const isProviderWebSearch = (
  tool: AgentTool,
): tool is ProviderWebSearchTool =>
  'provider' in tool && tool.provider === 'anthropic_web_search'

// Anthropic runs this search server-side, so there is nothing for gp-api to
// execute. An engine registers it as a provider tool instead: the AI SDK
// through aiSdkWebSearch, LangChain through langChainWebSearch.
export const webSearch: ProviderWebSearchTool = {
  name: 'web_search',
  description:
    'Search the public web. Returns result titles, URLs and snippets. Use fetchPage to read a result.',
  input: WebSearchInput,
  provider: 'anthropic_web_search',
  maxUses: 5,
  execute: async () => {
    throw new Error(
      'web_search runs on the model provider; register it with aiSdkWebSearch or langChainWebSearch',
    )
  },
}

export const aiSdkWebSearch = (tool: ProviderWebSearchTool) =>
  anthropic.tools.webSearch_20250305({ maxUses: tool.maxUses })

export const langChainWebSearch = (tool: ProviderWebSearchTool) => ({
  type: 'web_search_20250305' as const,
  name: tool.name,
  max_uses: tool.maxUses,
})
