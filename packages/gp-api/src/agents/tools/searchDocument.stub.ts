import { z } from 'zod'
import type { AgentTool } from './tool'

const input = z.object({ url: z.string().url(), query: z.string().min(1) })

export const searchDocument: AgentTool<typeof input> = {
  name: 'searchDocument',
  description: 'Search a PDF or Word document for passages matching a query.',
  input,
  execute: async () => {
    throw new Error('searchDocument is a stub until the web tools land')
  },
}
