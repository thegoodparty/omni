import http from 'http'
import https from 'https'
import { Injectable } from '@nestjs/common'
import axios from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import {
  assertPublicHostname,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'
import {
  ensureUrlHasProtocol,
  getUrlHostname,
} from '@/shared/util/strings.util'
import { CvPreSubmissionVerdictSchema } from '../schemas/cvPreSubmissionVerdict.schema'
import { isJunkFilingHost } from '../utils/cvPreSubmissionValidation.util'

const FILING_PAGE_FETCH_TIMEOUT_MS = 10_000
// Bounds prompt size/cost — the LLM only needs enough of the page to find the
// candidate's name and evidence of a filing, not the full document.
const FILING_PAGE_MAX_CONTENT_CHARS = 15_000

export type CvPreSubmissionValidationResult =
  | { outcome: 'passed' }
  | { outcome: 'failed'; reasons: string[] }
  // A fetch/LLM failure is not evidence the URL is bad — never hold or alert
  // on this outcome, just let the caller retry later (ENG-10965).
  | { outcome: 'transient' }

const SYSTEM_PROMPT = [
  'You are validating a 10DLC Campaign Verify filing-URL submission before',
  "it reaches Peerly. You are given the candidate's name and the raw",
  'content fetched from the URL they submitted as their official election',
  'filing. Decide, strictly from the page content, on three checks:',
  '',
  "- urlAcceptable: the page is the election authority's own online",
  '  publication of the filing, or a searchable database it can be found',
  "  in, or (only if no online resource exists) the election authority's",
  '  own contact page. NOT acceptable: a file-sharing link (e.g. Google',
  '  Drive), a social media page (e.g. Facebook), an unrelated government',
  '  page (e.g. an IRS EIN-assignment confirmation), a goodparty.org page,',
  '  a search engine results page, or any other site that is not the',
  "  election authority's own publication.",
  '- nameFound: the candidate name given below appears on the page, or a',
  '  clear match/variant of it (minor formatting differences are fine).',
  '- filingEvidenced: the page shows evidence that this specific candidate',
  '  has an actual filing on record — not just a form to check filings, and',
  '  not a page stating the filing window has not opened yet. If the page',
  '  says the election has not commenced or filing has not opened, mark',
  '  this false.',
  '',
  'reasons must explain every check you marked false, one entry per failed',
  'check, specific and concrete (e.g. "page is a Google Drive file, not an',
  'election authority site", not "bad URL"). Omit reasons for checks marked',
  'true. If the page content is empty, unrelated, or unreadable, mark every',
  'check false and say so.',
].join('\n')

// Fetch-then-LLM pre-submission gate for the filing URL / candidate name
// CampaignVerify will check (ENG-10965). Cheap deterministic checks (URL
// parses, hostname isn't an obvious junk source) run first and never touch
// the network or the LLM; only a page that passes those is fetched
// (SSRF-safe, same agent verify-live uses) and handed to the LLM for a
// structured verdict.
@Injectable()
export class CvPreSubmissionValidationService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly llm: LlmService,
  ) {
    this.logger.setContext(CvPreSubmissionValidationService.name)
  }

  async validate(params: {
    filingUrl: string
    submissionName: string
  }): Promise<CvPreSubmissionValidationResult> {
    const { filingUrl, submissionName } = params

    const hostname = getUrlHostname(filingUrl)
    if (!hostname) {
      return {
        outcome: 'failed',
        reasons: ['Filing URL is not a valid, public URL'],
      }
    }
    if (isJunkFilingHost(hostname)) {
      return {
        outcome: 'failed',
        reasons: [
          `Filing URL host "${hostname}" is not an election authority's ` +
            'own site (file share, social page, or unrelated site)',
        ],
      }
    }

    try {
      await assertPublicHostname(hostname)
    } catch {
      return {
        outcome: 'failed',
        reasons: [
          `Filing URL host "${hostname}" does not resolve to a public address`,
        ],
      }
    }

    const pageText = await this.fetchFilingPageText(filingUrl)
    if (pageText === null) {
      return { outcome: 'transient' }
    }

    try {
      const { object: verdict } = await this.llm.jsonCompletion({
        messages: this.buildMessages(pageText, submissionName, filingUrl),
        schema: CvPreSubmissionVerdictSchema,
        temperature: 0,
        maxTokens: 512,
      })
      if (
        verdict.urlAcceptable &&
        verdict.nameFound &&
        verdict.filingEvidenced
      ) {
        return { outcome: 'passed' }
      }
      return { outcome: 'failed', reasons: verdict.reasons }
    } catch (err) {
      this.logger.warn(
        { err, filingUrl },
        '[CV pre-submission] LLM verdict failed; treating as transient',
      )
      return { outcome: 'transient' }
    }
  }

  // Returns the fetched page text, or null on any fetch failure/empty body —
  // a vendor blip, never evidence the URL is bad.
  private async fetchFilingPageText(filingUrl: string): Promise<string | null> {
    try {
      const response = await axios.get<string>(
        ensureUrlHasProtocol(filingUrl),
        {
          timeout: FILING_PAGE_FETCH_TIMEOUT_MS,
          responseType: 'text',
          validateStatus: (status) => status >= 200 && status < 300,
          maxRedirects: 5,
          transformResponse: [(data: string) => data],
          httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
          httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
        },
      )
      const body = typeof response.data === 'string' ? response.data : ''
      if (!body.trim()) {
        this.logger.warn(
          { filingUrl },
          '[CV pre-submission] filing page fetch returned an empty body',
        )
        return null
      }
      return body.slice(0, FILING_PAGE_MAX_CONTENT_CHARS)
    } catch (err) {
      this.logger.warn(
        { err, filingUrl },
        '[CV pre-submission] filing page fetch failed; treating as transient',
      )
      return null
    }
  }

  private buildMessages(
    pageText: string,
    submissionName: string,
    filingUrl: string,
  ): LlmMessage[] {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Candidate name: ${submissionName}`,
          `Filing URL: ${filingUrl}`,
          'Page content:',
          '"""',
          pageText,
          '"""',
        ].join('\n'),
      },
    ]
  }
}
