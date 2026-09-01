import http from 'http'
import https from 'https'
import * as dns from 'node:dns'
import { promisify } from 'node:util'
import { Injectable } from '@nestjs/common'
import axios from 'axios'
import { MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import sanitizeHtml from 'sanitize-html'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { parsePdfText } from '@/ocr/extractors/pdf.extractor'
import {
  isPublicAddress,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'
import {
  ensureUrlHasProtocol,
  getUrlHostname,
} from '@/shared/util/strings.util'
import { CvPreSubmissionVerdictSchema } from '../schemas/cvPreSubmissionVerdict.schema'
import { isJunkFilingHost } from '../utils/cvPreSubmissionValidation.util'

const dnsLookup = promisify(dns.lookup)

const FILING_PAGE_FETCH_TIMEOUT_MS = 10_000
// Bounds prompt size/cost — the LLM only needs enough of the page to find the
// candidate's name and evidence of a filing, not the full document.
const FILING_PAGE_MAX_CONTENT_CHARS = 15_000
// Always-included lead-in — keeps the page's own framing (title, header)
// even when the name only appears deep in a long document.
const FILING_PAGE_HEAD_CHARS = 5_000
// Half-width of each name-match window (~1.5k chars per match, centered).
const NAME_WINDOW_RADIUS_CHARS = 750
// Below this, the extracted text is too thin to be a real page read — a
// scanned PDF with no text layer, or a JS app shell that never hydrated.
// Never hand this to the LLM: it would confidently report the name as
// missing for content it never actually saw (real cases: a scanned filing
// affidavit and a near-empty client-rendered shell, Aug 2026 triage).
const MIN_READABLE_TEXT_CHARS = 500

// A vendor-looking UA — several election-authority sites (e.g.
// klec.ky.gov) 403 the default axios UA but 200 a browser one.
const FILING_PAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const PDF_MAGIC_BYTES = '%PDF'

// Plain numbers, not HttpStatus: axios reports status as a number, and
// comparing that to the HttpStatus enum trips no-unsafe-enum-comparison
// (same reasoning as callhubHttp.service.ts).
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_SERVER_ERROR_MIN = 500

export type CvPreSubmissionValidationResult =
  | { outcome: 'passed' }
  | { outcome: 'failed'; reasons: string[] }
  // A fetch/LLM failure is not evidence the URL is bad — never hold or alert
  // on this outcome, just let the caller retry later (ENG-10965).
  | { outcome: 'transient' }

type FilingPageFetchResult =
  | { kind: 'ok'; text: string; pdfBody: Buffer | null }
  | { kind: 'http_error'; status: number }
  | { kind: 'network_error' }

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

const isPdfBody = (contentType: string | null, body: Buffer): boolean =>
  (contentType ?? '').toLowerCase().includes(MimeTypes.APPLICATION_PDF) ||
  body.subarray(0, PDF_MAGIC_BYTES.length).toString('latin1') ===
    PDF_MAGIC_BYTES

const HTML_ENTITY_DECODES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

// sanitize-html strips tags but still HTML-escapes the text it keeps (it's
// built to re-embed, not to extract plain text) — undo that so a name like
// "O&apos;Brien" reads as "O'Brien" for matching/windowing.
const decodeBasicHtmlEntities = (text: string): string =>
  text
    .replace(
      /&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g,
      (entity) => HTML_ENTITY_DECODES[entity] ?? entity,
    )
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )

const extractVisibleText = (html: string): string =>
  decodeBasicHtmlEntities(
    sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }),
  )
    .replace(/\s+/g, ' ')
    .trim()

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const findMatchIndexes = (text: string, needle: string): number[] => {
  if (!needle) {
    return []
  }
  const pattern = new RegExp(escapeRegExp(needle), 'gi')
  const indexes: number[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    indexes.push(match.index)
  }
  return indexes
}

const buildMergedRanges = (
  text: string,
  needle: string,
): [number, number][] => {
  const merged: [number, number][] = []
  for (const index of findMatchIndexes(text, needle)) {
    const start = Math.max(0, index - NAME_WINDOW_RADIUS_CHARS)
    const end = Math.min(text.length, index + NAME_WINDOW_RADIUS_CHARS)
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

const rangesOverlap = (a: [number, number], b: [number, number]): boolean =>
  a[0] < b[1] && b[0] < a[1]

// Windows around every match of the full submission name, then (lower
// priority) every match of just its last token — a results table that only
// prints the last name would otherwise lose the match to truncation even
// though a human would recognize it. Full-name windows are returned first so
// a common surname (several unrelated rows sharing it on a filing-database
// results page) can't crowd the real match out of the budget in
// buildLlmPageContent.
const buildNameWindows = (text: string, submissionName: string): string[] => {
  const trimmedName = submissionName.trim()
  const lastToken = trimmedName.split(/\s+/).pop() ?? ''
  const strongRanges = buildMergedRanges(text, trimmedName)
  const weakRanges =
    lastToken && lastToken !== trimmedName
      ? buildMergedRanges(text, lastToken).filter(
          (range) =>
            !strongRanges.some((strong) => rangesOverlap(range, strong)),
        )
      : []
  return [...strongRanges, ...weakRanges].map(([start, end]) =>
    text.slice(start, end),
  )
}

const CONTENT_SEPARATOR = '\n...\n'

// Guarantees nameFound can't be lost to truncation: the head keeps the
// page's own framing, and a window around every occurrence of the name (or
// its last token) is added — highest-priority (full-name) windows first —
// until the cap is reached, rather than joining everything and slicing the
// end, which silently dropped whichever windows came last (frequently the
// real match, sitting near the tail of the document).
const buildLlmPageContent = (text: string, submissionName: string): string => {
  if (text.length <= FILING_PAGE_MAX_CONTENT_CHARS) {
    return text
  }
  const head = text.slice(0, FILING_PAGE_HEAD_CHARS)
  let content = head
  for (const window of buildNameWindows(text, submissionName)) {
    if (head.includes(window)) {
      continue
    }
    const candidate = content + CONTENT_SEPARATOR + window
    if (candidate.length <= FILING_PAGE_MAX_CONTENT_CHARS) {
      content = candidate
    }
  }
  return content
}

const buildHttpErrorReason = (status: number): string => {
  if (status === HTTP_NOT_FOUND) {
    return `Filing URL returns HTTP ${status} (page not found)`
  }
  if (status === HTTP_FORBIDDEN) {
    return (
      `Filing URL blocks automated access (HTTP ${status}); staff ` +
      'review needed'
    )
  }
  return `Filing URL returned HTTP ${status}; staff review needed`
}

const UNREADABLE_PAGE_REASON =
  'The filing page could not be read automatically (no readable text ' +
  'found — a scanned PDF with no text layer, or a page that renders via ' +
  'JavaScript with no server-rendered content); staff review needed'

// Above this, skip the vision pass entirely rather than inline a large
// document into the completion request — a scanned filing affidavit is a
// handful of pages, so a PDF past this size is not the case this fallback
// exists for.
const MAX_VISION_PDF_BYTES = 4 * 1024 * 1024

const OVERSIZED_SCANNED_PDF_REASON =
  'The filing PDF has no readable text and is too large (over 4MB) for ' +
  'automated visual review; staff review needed'

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

    // Deliberately not the shared assertPublicHostname (websites.service.ts):
    // that helper treats a non-resolving hostname as PASS (returns silently)
    // because its own caller (verifyLive) checks a domain GoodParty just
    // purchased, where "doesn't resolve yet" means DNS is still propagating —
    // a wait, not a failure. A candidate-submitted filing URL has no such
    // excuse: a host that doesn't resolve at all is a bad submission
    // (typo/fake domain), not a propagation delay, so it's held as 'failed'
    // here rather than falling through to fetchFilingPageText and coming
    // back 'transient' (retried indefinitely, never reported to anyone).
    let addresses: dns.LookupAddress[]
    try {
      addresses = await dnsLookup(hostname, { all: true })
    } catch {
      addresses = []
    }
    if (addresses.length === 0) {
      return {
        outcome: 'failed',
        reasons: [
          `Filing URL host "${hostname}" does not resolve to any address`,
        ],
      }
    }
    const offendingAddress = addresses.find(
      ({ address }) => !isPublicAddress(address),
    )
    if (offendingAddress) {
      return {
        outcome: 'failed',
        reasons: [
          `Filing URL host "${hostname}" does not resolve to a public address`,
        ],
      }
    }

    const fetchResult = await this.fetchFilingPageText(filingUrl)
    if (fetchResult.kind === 'network_error') {
      return { outcome: 'transient' }
    }
    if (fetchResult.kind === 'http_error') {
      // A deterministic non-2xx is not evidence of a vendor blip — a dead
      // link or an access block is a bad submission that must hold, not
      // retry forever (ENG-10998). Only a server-side failure is transient.
      if (fetchResult.status >= HTTP_SERVER_ERROR_MIN) {
        return { outcome: 'transient' }
      }
      return {
        outcome: 'failed',
        reasons: [buildHttpErrorReason(fetchResult.status)],
      }
    }

    if (fetchResult.text.length < MIN_READABLE_TEXT_CHARS) {
      if (!fetchResult.pdfBody) {
        return { outcome: 'failed', reasons: [UNREADABLE_PAGE_REASON] }
      }
      return this.validateScannedPdfWithVision(
        fetchResult.pdfBody,
        submissionName,
        filingUrl,
      )
    }

    const pageContent = buildLlmPageContent(fetchResult.text, submissionName)

    try {
      const { object: verdict } = await this.llm.jsonCompletion({
        messages: this.buildMessages(pageContent, submissionName, filingUrl),
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

  private async fetchFilingPageText(
    filingUrl: string,
  ): Promise<FilingPageFetchResult> {
    let response
    try {
      response = await axios.get<ArrayBuffer>(ensureUrlHasProtocol(filingUrl), {
        timeout: FILING_PAGE_FETCH_TIMEOUT_MS,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        maxRedirects: 5,
        headers: { 'User-Agent': FILING_PAGE_USER_AGENT },
        httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
        httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
      })
    } catch (err) {
      this.logger.warn(
        { err, filingUrl },
        '[CV pre-submission] filing page fetch failed; treating as transient',
      )
      return { kind: 'network_error' }
    }

    if (response.status < 200 || response.status >= 300) {
      this.logger.warn(
        { filingUrl, status: response.status },
        '[CV pre-submission] filing page fetch returned a non-2xx status',
      )
      return { kind: 'http_error', status: response.status }
    }

    const body = Buffer.from(response.data)
    const contentType = response.headers['content-type']
    const normalizedContentType =
      typeof contentType === 'string' ? contentType : null
    const text = await this.extractPageText(body, normalizedContentType)
    return {
      kind: 'ok',
      text,
      pdfBody: isPdfBody(normalizedContentType, body) ? body : null,
    }
  }

  private async extractPageText(
    body: Buffer,
    contentType: string | null,
  ): Promise<string> {
    if (isPdfBody(contentType, body)) {
      return this.extractPdfText(body)
    }
    return extractVisibleText(body.toString('utf-8'))
  }

  private async extractPdfText(body: Buffer): Promise<string> {
    try {
      const { text } = await parsePdfText(new Uint8Array(body))
      return text
    } catch (err) {
      // A corrupt/unparseable PDF is unreadable, not a fetch failure — fall
      // through to the same near-empty-text handling a scanned image gets,
      // rather than letting pdf-parse's throw escape validate() uncaught.
      this.logger.warn(
        { err },
        '[CV pre-submission] PDF text extraction failed; treating as unreadable',
      )
      return ''
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

  // A scanned PDF whose text layer is empty or OCR garbage still has real
  // content a vision-capable model can read directly off the page images
  // (Claude's document support). Runs the same three-check verdict as the
  // text path, with the PDF attached instead of extracted text.
  private async validateScannedPdfWithVision(
    pdfBody: Buffer,
    submissionName: string,
    filingUrl: string,
  ): Promise<CvPreSubmissionValidationResult> {
    if (pdfBody.byteLength > MAX_VISION_PDF_BYTES) {
      return {
        outcome: 'failed',
        reasons: [OVERSIZED_SCANNED_PDF_REASON],
      }
    }

    try {
      const { object: verdict } = await this.llm.jsonCompletion({
        messages: this.buildVisionMessages(pdfBody, submissionName, filingUrl),
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
      // The PDF genuinely couldn't be machine-read (text layer empty and
      // vision failed too) — this is the pre-phase-2 unreadable hold, not a
      // transient vendor blip. Never let a vision failure become an
      // infinite retry.
      this.logger.warn(
        { err, filingUrl },
        '[CV pre-submission] vision verdict failed; holding as unreadable',
      )
      return { outcome: 'failed', reasons: [UNREADABLE_PAGE_REASON] }
    }
  }

  private buildVisionMessages(
    pdfBody: Buffer,
    submissionName: string,
    filingUrl: string,
  ): LlmMessage[] {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Candidate name: ${submissionName}`,
              `Filing URL: ${filingUrl}`,
              'The filing page is a PDF with no extractable text layer ' +
                '(likely a scanned document) — it is attached below. Read ' +
                'it visually to make the same three checks.',
            ].join('\n'),
          },
          {
            type: 'file',
            data: new Uint8Array(pdfBody),
            mediaType: MimeTypes.APPLICATION_PDF,
          },
        ],
      },
    ]
  }
}
