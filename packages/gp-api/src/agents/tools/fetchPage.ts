import { z } from 'zod'
import {
  AgentWebService,
  looksLikeHtml,
  markdownFromHtml,
} from './agentWeb.service'
import { defineTool } from './tool'

const PAGE_CHARS = 10_000

const fetchPageInput = z.object({
  url: z.string().describe('Absolute http(s) URL'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Character offset to read on from, for a truncated page'),
})

const isText = (contentType: string): boolean =>
  /^(text\/|application\/(json|xml|ld\+json|xhtml\+xml))/.test(contentType)

// The names publishers put a story's own date under. A claim that has to sit
// inside a window is only as good as the date it is dated by, and a search
// snippet's date is often wrong.
const PUBLISHED_FIELDS = new Set([
  'article:published_time',
  'article:published',
  'og:article:published_time',
  'datepublished',
  'date',
  'publish-date',
  'pubdate',
  'dc.date',
  'dc.date.issued',
  'parsely-pub-date',
  'sailthru.date',
])

// Only the day matters, and the literal prefix is the publisher's own day:
// parsing a 23:30 -05:00 timestamp would roll it to the next day in UTC.
const dayIn = (value: string): string | undefined => {
  const literal = /\b(20\d{2})[-/](\d{2})[-/](\d{2})(?!\d)/.exec(value)
  if (literal) return `${literal[1]}-${literal[2]}-${literal[3]}`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

// Meta tags, then <time datetime>, then JSON-LD. Undefined when the page
// carries no date this can trust.
const publishedIn = (html: string): string | undefined => {
  const dates: string[] = []
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const field = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(
      tag,
    )?.[1]
    if (field === undefined || !PUBLISHED_FIELDS.has(field.toLowerCase()))
      continue
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (content !== undefined) dates.push(content)
  }
  for (const tag of html.match(/<time\b[^>]*>/gi) ?? []) {
    const datetime = /\bdatetime\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (datetime !== undefined) dates.push(datetime)
  }
  const jsonLd = /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1]
  if (jsonLd !== undefined) dates.push(jsonLd)
  for (const date of dates) {
    const day = dayIn(date)
    if (day !== undefined) return day
  }
  return undefined
}

// Plain HTTP, no browser: a page that needs JavaScript comes back thin.
export const fetchPage = defineTool({
  description: `Read a web page as markdown with links. Returns up to ${PAGE_CHARS} characters and the page's own published date when its markup carries one; pass offset to read on. Does not run JavaScript and does not read PDF or Word files.`,
  input: fetchPageInput,
  execute: async ({ url, offset = 0 }, ctx) => {
    const page = await ctx.get(AgentWebService).get(ctx, url)
    if (!page.ok) return page
    if (page.status < 200 || page.status >= 300) {
      return { ok: false, reason: 'http_error', status: page.status }
    }
    if (!isText(page.contentType)) {
      return {
        ok: false,
        reason: 'unsupported_content_type',
        contentType: page.contentType || 'unknown',
      }
    }
    const body = page.body.toString('utf8')
    // Meta tags are in the head, but JSON-LD sometimes lands well below it;
    // the first 500 KB covers both without scanning a 10 MB page.
    const published = publishedIn(body.slice(0, 500_000))
    // The broker records a rendered page as its visible text under the
    // page's own content type, so a replayed "HTML" page may be plain text.
    const text = looksLikeHtml(body) ? markdownFromHtml(body) : body.trim()
    const content = text.slice(offset, offset + PAGE_CHARS)
    return {
      ok: true,
      url,
      finalUrl: page.finalUrl,
      status: page.status,
      content,
      offset,
      totalChars: text.length,
      truncated: offset + content.length < text.length,
      published: published ?? null,
    }
  },
})
