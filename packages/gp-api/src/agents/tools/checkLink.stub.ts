import { z } from 'zod'
import type { AgentTool } from './tool'

const input = z.object({ url: z.string().url() })

export const checkLink: AgentTool<typeof input> = {
  name: 'checkLink',
  description:
    'Check whether a URL is live. Returns its HTTP status and final URL after redirects.',
  input,
  execute: async () => {
    throw new Error('checkLink is a stub until the web tools land')
  },
}
