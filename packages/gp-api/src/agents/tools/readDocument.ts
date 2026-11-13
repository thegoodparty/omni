import { z } from 'zod'
import { AgentWebService } from './agentWeb.service'
import type { AgentTool } from './tool'

const MAX_PAGES_PER_CALL = 20
const MAX_CHARS_PER_CALL = 40_000

const ReadDocumentInput = z.object({
  url: z.string().describe('Absolute http(s) URL of a PDF or Word file'),
  pages: z
    .string()
    .regex(/^\d+(-\d+)?$/)
    .optional()
    .describe('A page or page range, such as "3" or "5-12". Defaults to 1-20.'),
})

export const readDocument: AgentTool<typeof ReadDocumentInput> = {
  name: 'readDocument',
  description:
    'Read the text of a PDF or Word document a page range at a time, up to 20 pages per call. Word files are split into page-sized sections. Use searchDocument to find pages first in a long packet.',
  input: ReadDocumentInput,
  execute: async ({ url, pages }, ctx) => {
    const web = ctx.moduleRef.get(AgentWebService, { strict: false })
    const document = await web.document(ctx, url)
    if (!document.ok) return document
    const total = document.pages.length
    const [fromText, toText] = (pages ?? `1-${MAX_PAGES_PER_CALL}`).split('-')
    const from = Math.max(1, Number(fromText))
    const to = Math.min(
      total,
      Number(toText ?? fromText),
      from + MAX_PAGES_PER_CALL - 1,
    )
    if (from > total || to < from) {
      return { ok: false, reason: 'page_out_of_range', totalPages: total }
    }
    const read: { page: number; text: string }[] = []
    let chars = 0
    for (let page = from; page <= to; page++) {
      const text = document.pages[page - 1] ?? ''
      if (read.length > 0 && chars + text.length > MAX_CHARS_PER_CALL) break
      read.push({ page, text: text.slice(0, MAX_CHARS_PER_CALL) })
      chars += text.length
    }
    const lastRead = read.at(-1)?.page ?? from
    return {
      ok: true,
      url,
      finalUrl: document.finalUrl,
      documentType: document.kind,
      totalPages: total,
      pages: read,
      nextPage: lastRead < total ? lastRead + 1 : null,
    }
  },
}
