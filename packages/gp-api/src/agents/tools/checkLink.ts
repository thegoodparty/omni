import { z } from 'zod'
import { AgentWebService } from './agentWeb.service'
import type { AgentTool } from './tool'

const CheckLinkInput = z.object({
  url: z.string().describe('Absolute http(s) URL'),
})

export const checkLink: AgentTool<typeof CheckLinkInput> = {
  name: 'checkLink',
  description:
    'Check that a URL resolves before citing it. Returns the HTTP status and the final URL after redirects, without reading the body.',
  input: CheckLinkInput,
  execute: async ({ url }, ctx) => {
    const web = ctx.moduleRef.get(AgentWebService, { strict: false })
    const link = await web.link(ctx, url)
    if (!link.ok) return link
    return {
      ok: true,
      url,
      status: link.status,
      finalUrl: link.finalUrl,
      reachable: link.status >= 200 && link.status < 400,
    }
  },
}
