import { z } from 'zod'
import {
  AgentBrowserService,
  MAX_RENDERS_PER_RUN,
} from './agentBrowser.service'
import { looksLikeHtml, markdownFromHtml } from './agentWeb.service'
import { PAGE_CHARS, publishedIn } from './fetchPage'
import { defineTool, type ToolContext } from './tool'

const renderPageInput = z.object({
  url: z.string().describe('Absolute http(s) URL'),
})

const readable = (
  url: string,
  finalUrl: string,
  status: number,
  body: string,
) => {
  const published = publishedIn(body.slice(0, 500_000))
  const text = looksLikeHtml(body) ? markdownFromHtml(body) : body.trim()
  const content = text.slice(0, PAGE_CHARS)
  return {
    ok: true as const,
    url,
    finalUrl,
    status,
    content,
    totalChars: text.length,
    truncated: content.length < text.length,
    published: published ?? null,
  }
}

const rendered = async (url: string, ctx: ToolContext) => {
  const page = await ctx.get(AgentBrowserService).render(ctx, url)
  if (!page.ok) return page
  if (page.status < 200 || page.status >= 300) {
    return { ok: false, reason: 'http_error', status: page.status }
  }
  const result = readable(url, page.finalUrl, page.status, page.html)
  if (result.content.trim() === '') return { ok: false, reason: 'no_text' }
  return result
}

export const renderPage = defineTool({
  description: `Open a web page in a real browser, run its JavaScript, and read it as markdown with links: up to ${PAGE_CHARS} characters, the final URL, the status and the page's own published date. Slow and limited to ${MAX_RENDERS_PER_RUN} calls a run: use it only on a page fetchPage could not read.`,
  input: renderPageInput,
  execute: ({ url }, ctx) => rendered(url, ctx),
})
