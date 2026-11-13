import { z } from 'zod'
import type { AgentTool } from './tool'

const input = z.object({ url: z.string().url() })

export const fetchPage: AgentTool<typeof input> = {
  name: 'fetchPage',
  description:
    'Fetch a web page and return its text, its final URL and its HTTP status.',
  input,
  execute: async () => {
    throw new Error('fetchPage is a stub until the web tools land')
  },
}
