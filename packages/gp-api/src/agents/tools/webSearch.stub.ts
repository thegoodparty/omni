import { z } from 'zod'
import type { AgentTool } from './tool'

const input = z.object({ query: z.string().min(1) })

export const webSearch: AgentTool<typeof input> = {
  name: 'webSearch',
  description:
    'Search the web. Returns results with titles, URLs and snippets.',
  input,
  execute: async () => {
    throw new Error('webSearch is a stub until the web tools land')
  },
}
