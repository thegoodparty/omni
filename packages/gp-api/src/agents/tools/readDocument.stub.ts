import { z } from 'zod'
import type { AgentTool } from './tool'

const input = z.object({ url: z.string().url(), pages: z.string().optional() })

export const readDocument: AgentTool<typeof input> = {
  name: 'readDocument',
  description:
    'Read the text of a PDF or Word document, a page range at a time.',
  input,
  execute: async () => {
    throw new Error('readDocument is a stub until the web tools land')
  },
}
