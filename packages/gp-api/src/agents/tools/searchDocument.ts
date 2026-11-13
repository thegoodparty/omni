import { z } from 'zod'
import { AgentWebService } from './agentWeb.service'
import type { AgentTool } from './tool'

const MAX_MATCHES = 25
const CONTEXT_CHARS = 250

const SearchDocumentInput = z.object({
  url: z.string().describe('Absolute http(s) URL of a PDF or Word file'),
  query: z
    .string()
    .min(2)
    .describe(
      'Words or a phrase to find, case-insensitive. Separate alternatives with |, as in "rezoning|zoning map".',
    ),
})

// Literal phrases only, never a model-written regex: a backtracking pattern
// over a megabyte of packet text would stall the whole process.
export const searchDocument: AgentTool<typeof SearchDocumentInput> = {
  name: 'searchDocument',
  description:
    'Find passages in a PDF or Word document. Returns each match with its page number and surrounding text, so you can readDocument just those pages.',
  input: SearchDocumentInput,
  execute: async ({ url, query }, ctx) => {
    const web = ctx.moduleRef.get(AgentWebService, { strict: false })
    const document = await web.document(ctx, url)
    if (!document.ok) return document
    const needles = query
      .split('|')
      .map((part) => part.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((part) => part.length > 0)
    const matches: { page: number; match: string; excerpt: string }[] = []
    let totalMatches = 0
    document.pages.forEach((pageText, index) => {
      const text = pageText.replace(/\s+/g, ' ')
      const lower = text.toLowerCase()
      for (const needle of needles) {
        let at = lower.indexOf(needle)
        while (at !== -1) {
          totalMatches += 1
          if (matches.length < MAX_MATCHES) {
            matches.push({
              page: index + 1,
              match: text.slice(at, at + needle.length),
              excerpt: text.slice(
                Math.max(0, at - CONTEXT_CHARS),
                at + needle.length + CONTEXT_CHARS,
              ),
            })
          }
          at = lower.indexOf(needle, at + needle.length)
        }
      }
    })
    return {
      ok: true,
      url,
      totalPages: document.pages.length,
      totalMatches,
      matches,
      truncated: totalMatches > matches.length,
    }
  },
}
