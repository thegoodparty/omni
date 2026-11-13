import { z } from 'zod'
import { AgentWebService } from './agentWeb.service'
import type { AgentTool } from './tool'

const MAX_PAGE_CHARS = 24_000
const DOCUMENT_PREVIEW_CHARS = 2_000

const FetchPageInput = z.object({
  url: z.string().describe('Absolute http(s) URL'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Character offset to continue a truncated page from'),
})

export const fetchPage: AgentTool<typeof FetchPageInput> = {
  name: 'fetchPage',
  description:
    'Read a web page as markdown with absolute links. Renders pages that need JavaScript. Long pages are truncated; pass offset to read on. A PDF or Word file returns its page count and first page; read it with readDocument.',
  input: FetchPageInput,
  execute: async ({ url, offset = 0 }, ctx) => {
    const web = ctx.moduleRef.get(AgentWebService, { strict: false })
    const page = await web.page(ctx, url, offset > 0)
    if (!page.ok) return page
    if (page.kind === 'document') {
      const { document } = page
      return {
        ok: true,
        kind: 'document',
        url,
        finalUrl: document.finalUrl,
        documentType: document.kind,
        totalPages: document.pages.length,
        firstPage: (document.pages[0] ?? '').slice(0, DOCUMENT_PREVIEW_CHARS),
        next: 'Use readDocument or searchDocument with this URL to read it.',
      }
    }
    const content = page.text.slice(offset, offset + MAX_PAGE_CHARS)
    return {
      ok: true,
      kind: 'page',
      url,
      finalUrl: page.resource.finalUrl,
      status: page.resource.status,
      rendered: page.resource.via === 'browser',
      content,
      offset,
      totalChars: page.text.length,
      truncated: offset + content.length < page.text.length,
    }
  },
}
