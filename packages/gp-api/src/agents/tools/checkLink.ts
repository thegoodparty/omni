import { z } from 'zod'
import { AgentWebService } from './agentWeb.service'
import { defineTool } from './tool'

const checkLinkInput = z.object({
  url: z.string().describe('Absolute http(s) URL'),
})

export const checkLink = defineTool({
  description:
    'Check that a URL resolves before citing it, without reading the page. Returns the HTTP status of a HEAD request and the final URL after redirects. Some sites answer HEAD with 403 or 405; read those with fetchPage.',
  input: checkLinkInput,
  execute: async ({ url }, ctx) => {
    const link = await ctx.get(AgentWebService).head(ctx, url)
    if (!link.ok) return link
    return { ok: true, url, status: link.status, finalUrl: link.finalUrl }
  },
})
