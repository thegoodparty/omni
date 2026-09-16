import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

// GoodParty.org's help center is a HubSpot-hosted knowledge base, and
// HubSpot's site-search endpoint indexes it. Two things make this cheap: the
// portal id is already public (it is in the page source, as the support
// widget's script src), and the endpoint needs no credential, no scope, and
// no Service Hub tier. So this works in every environment with no config.
const HUBSPOT_PORTAL_ID = '21589597'
const SEARCH_URL = 'https://api.hubapi.com/cms/v3/site-search/search'
const SEARCH_TIMEOUT_MS = 8_000

// Five is what a chat answer can use. The index holds ~65 public articles, so
// a wider result set is noise the model has to read past.
const MAX_RESULTS = 5

// Search wraps every term it matched in a highlight span, so a title arrives
// as 'Send a <span class="hs-search-highlight">Texting</span> Campaign'.
// Strip it or the model quotes markup back at the user.
const stripHighlights = (value: string): string =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const searchResultSchema = z.object({
  title: z.string().default(''),
  url: z.string().default(''),
  description: z.string().default(''),
  category: z.string().default(''),
  tags: z.array(z.string()).default([]),
  isPrivate: z.boolean().default(false),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema).default([]),
})

export interface HelpCenterArticle {
  title: string
  url: string
  summary: string
  category: string
  tags: string[]
}

export interface HelpCenterSearchResult {
  articles: HelpCenterArticle[]
  // Present instead of results when the search could not run. The tool hands
  // this to the model to relay, rather than throwing: a help-center outage
  // should degrade the answer, not fail the user's whole turn.
  error?: string
}

const UNAVAILABLE =
  'The help center search is unavailable right now, so answer from what you ' +
  'already know and offer the support chat if that is not enough.'

@Injectable()
export class HelpCenterSearchService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HelpCenterSearchService.name)
  }

  async search(query: string): Promise<HelpCenterSearchResult> {
    const params = new URLSearchParams({
      portalId: HUBSPOT_PORTAL_ID,
      q: query,
      type: 'KNOWLEDGE_ARTICLE',
      limit: String(MAX_RESULTS),
    })

    try {
      const resp = await fetch(`${SEARCH_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      })
      if (!resp.ok) {
        this.logger.warn(
          { status: resp.status },
          'Help center search returned non-ok',
        )
        return { articles: [], error: UNAVAILABLE }
      }
      const parsed = searchResponseSchema.safeParse(await resp.json())
      if (!parsed.success) {
        this.logger.warn(
          { err: parsed.error },
          'Help center search returned an unexpected shape',
        )
        return { articles: [], error: UNAVAILABLE }
      }
      return {
        articles: parsed.data.results
          // A private article is staff-only content; the search should not
          // return one to an unauthenticated caller, but never surface it if
          // it does.
          .filter((r) => !r.isPrivate && r.url.length > 0)
          .map((r) => ({
            title: stripHighlights(r.title),
            url: r.url,
            summary: stripHighlights(r.description),
            category: stripHighlights(r.category),
            tags: r.tags,
          })),
      }
    } catch (err) {
      this.logger.warn({ err }, 'Help center search failed')
      return { articles: [], error: UNAVAILABLE }
    }
  }
}
