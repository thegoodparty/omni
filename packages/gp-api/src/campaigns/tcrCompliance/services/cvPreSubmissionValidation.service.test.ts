import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import * as dns from 'node:dns'
import { PDFParse } from 'pdf-parse'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CvPreSubmissionValidationService } from './cvPreSubmissionValidation.service'

vi.mock('axios', async (orig) => {
  const real = await orig<typeof import('axios')>()
  return {
    default: { get: vi.fn() },
    AxiosError: real.AxiosError,
  }
})

vi.mock('node:dns', async (orig) => {
  const real = await orig<typeof import('node:dns')>()
  return { ...real, default: real, lookup: vi.fn() }
})

vi.mock('pdf-parse', () => ({ PDFParse: vi.fn() }))

const mockedAxiosGet = vi.mocked(axios.get)
const mockedDnsLookup = vi.mocked(dns.lookup)
const MockedPDFParse = vi.mocked(PDFParse)

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  result: dns.LookupAddress[],
) => void

// Resolves every hostname to a public IPv4 address unless overridden — keeps
// the SSRF pre-check out of the way for tests that aren't exercising it.
const stubDnsLookup = (addresses: dns.LookupAddress[] | Error) => {
  mockedDnsLookup.mockImplementation(
    (
      _hostname: string,
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const cb = (
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : maybeCallback
      ) as LookupCallback
      if (addresses instanceof Error) {
        cb(addresses as NodeJS.ErrnoException, [])
      } else {
        cb(null, addresses)
      }
    },
  )
}

const publicAddress: dns.LookupAddress[] = [
  { address: '93.184.216.34', family: 4 },
]

const params = {
  filingUrl: 'https://sos.state.gov/filings/jane-candidate',
  submissionName: 'Jane Candidate',
}

// Well over MIN_READABLE_TEXT_CHARS (500) so the default fixture reaches the
// LLM call in every test that doesn't override it.
const genuinePageHtml =
  '<html><body>' +
  '<p>Jane Candidate filed for office. Filing on record.</p>' +
  `<p>${'Additional filing details on record. '.repeat(20)}</p>` +
  '</body></html>'

const UNREADABLE_PAGE_REASON =
  'The filing page could not be read automatically (no readable text ' +
  'found — a scanned PDF with no text layer, or a page that renders via ' +
  'JavaScript with no server-rendered content); staff review needed'

const buildPdfParseMock = (text: string) => {
  MockedPDFParse.mockImplementation(function PDFParseMock() {
    return {
      getText: vi.fn().mockResolvedValue({ text, total: 1 }),
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as PDFParse
  })
}

// Every element far enough apart that only genuine name-anchored windowing
// (not a simple raised cap) would keep the name and drop the middle marker.
const buildLongPageWithNameNearTail = () => {
  const headMarker = 'HEAD-MARKER-CONTENT'
  const middleMarker = 'MIDDLE-MARKER-SHOULD-BE-DROPPED'
  const filler = (n: number) => 'x'.repeat(n)
  const text =
    `${headMarker} ${filler(7800)} ${middleMarker} ${filler(9500)} ` +
    `Jane Candidate ${filler(500)}`
  return {
    html: `<html><body><p>${text}</p></body></html>`,
    headMarker,
    middleMarker,
  }
}

// Several unrelated rows sharing only the submission's last name, all ahead
// of the real full-name match near the tail — proves windows around the
// full name are prioritized over last-token-only windows, so a common
// surname can't crowd the real match out of the 15k budget.
const buildLongPageWithSurnameCollisionsBeforeRealMatch = () => {
  const filler = (n: number) => 'x'.repeat(n)
  const noiseRow = (i: number) => `Lee filed for a different office row ${i}.`
  const noiseRows = Array.from(
    { length: 8 },
    (_, i) => `${noiseRow(i)} ${filler(3000)}`,
  ).join(' ')
  const text =
    `${filler(6000)} ${noiseRows} ` +
    `Jane Lee filed for office. Filing on record. ${filler(500)}`
  return { html: `<html><body><p>${text}</p></body></html>` }
}

// Raw HTML tag padding well past the 15k cap, with zero extracted text of
// its own — proves the name is rescued by extracting-before-capping, not
// lost to the old raw-body slice(0, 15000). The real sentence is padded past
// MIN_READABLE_TEXT_CHARS so the fixture reaches the LLM rather than tripping
// the unreadable-page check this same ticket adds.
const buildPaddedFilingHtml = (): string => {
  const padding = '<div class="pad"></div>'.repeat(800)
  return (
    `<html><body>${padding}` +
    '<p>Jane Candidate filed for office. Filing on record. ' +
    `${'Additional filing detail on record. '.repeat(20)}</p>` +
    '</body></html>'
  )
}

describe('CvPreSubmissionValidationService', () => {
  let service: CvPreSubmissionValidationService
  let llm: { jsonCompletion: ReturnType<typeof vi.fn> }

  const getLlmUserContent = (): string => {
    const args = llm.jsonCompletion.mock.calls[0]?.[0] as
      | { messages: { role: string; content: string }[] }
      | undefined
    return (
      args?.messages.find((message) => message.role === 'user')?.content ?? ''
    )
  }

  beforeEach(() => {
    llm = { jsonCompletion: vi.fn() }
    stubDnsLookup(publicAddress)
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from(genuinePageHtml),
      headers: { 'content-type': 'text/html' },
    })
    service = new CvPreSubmissionValidationService(
      createMockLogger(),

      llm as unknown as ConstructorParameters<
        typeof CvPreSubmissionValidationService
      >[1],
    )
  })

  it('passes when the LLM confirms all three checks', async () => {
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: true,
        reasons: [],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'passed' })
    expect(llm.jsonCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
    )
  })

  // Failure class 1: junk hostname — deterministic, no LLM call.
  it('fails on a junk filing-URL host without calling the LLM or fetching', async () => {
    const result = await service.validate({
      ...params,
      filingUrl: 'https://drive.google.com/file/d/abc123',
    })

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [
        'Filing URL host "drive.google.com" is not an election ' +
          "authority's own site (file share, social page, or unrelated " +
          'site)',
      ],
    })
    expect(mockedAxiosGet).not.toHaveBeenCalled()
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fails on an unparseable filing URL without calling the LLM or fetching', async () => {
    const result = await service.validate({
      ...params,
      filingUrl: 'not a url',
    })

    expect(result).toEqual({
      outcome: 'failed',
      reasons: ['Filing URL is not a valid, public URL'],
    })
    expect(mockedAxiosGet).not.toHaveBeenCalled()
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fails when the hostname resolves to a non-public address (SSRF)', async () => {
    stubDnsLookup([{ address: '127.0.0.1', family: 4 }])

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [
        `Filing URL host "sos.state.gov" does not resolve to a public address`,
      ],
    })
    expect(mockedAxiosGet).not.toHaveBeenCalled()
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  // Delegate review finding: a host that doesn't resolve at all (typo/fake
  // domain) is a deterministic bad submission, not a transient DNS blip — it
  // must be held as 'failed', never fall through to the fetch and come back
  // 'transient' (which would retry indefinitely and never tell anyone).
  // Deliberately not delegated to the shared assertPublicHostname helper,
  // which returns silently on empty resolution for its own caller
  // (verifyLive, checking a domain that may still be DNS-propagating).
  it('fails when the hostname does not resolve at all, without calling the LLM or fetching', async () => {
    stubDnsLookup([])

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [
        'Filing URL host "sos.state.gov" does not resolve to any address',
      ],
    })
    expect(mockedAxiosGet).not.toHaveBeenCalled()
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fails when DNS resolution itself throws (NXDOMAIN-style failure)', async () => {
    stubDnsLookup(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [
        'Filing URL host "sos.state.gov" does not resolve to any address',
      ],
    })
    expect(mockedAxiosGet).not.toHaveBeenCalled()
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  // Failure class 2/3: name not found / filing not evidenced — LLM-evaluated.
  it('fails with the LLM reasons when the candidate name is not found', async () => {
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: false,
        filingEvidenced: true,
        reasons: ['Candidate name does not appear on the filing page'],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: ['Candidate name does not appear on the filing page'],
    })
  })

  it('fails with the LLM reasons when the filing has not commenced', async () => {
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: false,
        reasons: ['Election date is 2027, filing has not commenced'],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: ['Election date is 2027, filing has not commenced'],
    })
  })

  // Transient path: the production error this ticket calls out — a real
  // fetch throw — must not be treated as a rejection.
  it('treats a filing-page fetch network failure as transient, never as a rejection', async () => {
    mockedAxiosGet.mockRejectedValue(new Error('ECONNRESET'))

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('treats a 5xx filing-page response as transient, never as a rejection', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 503,
      data: Buffer.from(''),
      headers: {},
    })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  // ENG-10998: a deterministic non-2xx is a bad submission, not a vendor
  // blip — it must hold with a concrete reason instead of retrying forever
  // through the agent's paid resume loop.
  it('fails with a concrete reason on a 404, without calling the LLM', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 404,
      data: Buffer.from(''),
      headers: {},
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: ['Filing URL returns HTTP 404 (page not found)'],
    })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('fails with a concrete reason on a 403 (automated-access block), without calling the LLM', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 403,
      data: Buffer.from(''),
      headers: {},
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [
        'Filing URL blocks automated access (HTTP 403); staff review needed',
      ],
    })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  // ENG-10997: a near-empty extracted page (JS shell that never hydrated) is
  // not a page the LLM ever really saw — it must not confidently report the
  // name as missing for content it never read.
  it('fails as unreadable when the page is a near-empty JS app shell, without calling the LLM', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from(
        '<html><body><div id="root"></div>' +
          '<script>console.log("Jane Candidate app bootstrap")</script>' +
          '</body></html>',
      ),
      headers: { 'content-type': 'text/html' },
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [UNREADABLE_PAGE_REASON],
    })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('rescues a candidate name that sits past the raw 15k cap once the HTML is stripped to visible text', async () => {
    const html = buildPaddedFilingHtml()
    expect(html.length).toBeGreaterThan(15_000)
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from(html),
      headers: { 'content-type': 'text/html' },
    })
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: true,
        reasons: [],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'passed' })
    expect(getLlmUserContent()).toContain('Jane Candidate')
  })

  it('windows around the name near the tail of long extracted text, dropping unrelated middle content', async () => {
    const { html, headMarker, middleMarker } = buildLongPageWithNameNearTail()
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from(html),
      headers: { 'content-type': 'text/html' },
    })
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: true,
        reasons: [],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'passed' })
    const content = getLlmUserContent()
    expect(content).toContain('Jane Candidate')
    expect(content).toContain(headMarker)
    expect(content).not.toContain(middleMarker)
  })

  // ai-rules/bugs.md-class fix: the original join-then-slice-from-the-front
  // dropped whichever windows came last once the budget ran out — exactly
  // the real match, sitting near the tail behind a wall of last-name-only
  // noise rows on a filing-database results page.
  it('prioritizes the full-name window over last-name-only noise so the real match survives the budget', async () => {
    const { html } = buildLongPageWithSurnameCollisionsBeforeRealMatch()
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from(html),
      headers: { 'content-type': 'text/html' },
    })
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: true,
        reasons: [],
      },
    })

    const result = await service.validate({
      filingUrl: params.filingUrl,
      submissionName: 'Jane Lee',
    })

    expect(result).toEqual({ outcome: 'passed' })
    expect(getLlmUserContent()).toContain('Jane Lee filed for office')
  })

  it('extracts PDF text so the LLM sees text, not binary', async () => {
    const extractedPdfText =
      'Jane Candidate filed for office. Filing on record. ' +
      'Additional detail on record. '.repeat(20)
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from('%PDF-1.4 not-real-binary'),
      headers: { 'content-type': 'application/pdf' },
    })
    buildPdfParseMock(extractedPdfText)
    llm.jsonCompletion.mockResolvedValue({
      object: {
        urlAcceptable: true,
        nameFound: true,
        filingEvidenced: true,
        reasons: [],
      },
    })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'passed' })
    const content = getLlmUserContent()
    expect(content).toContain('Jane Candidate')
    expect(content).not.toContain('%PDF')
  })

  it('fails as unreadable when a PDF has no extractable text (scanned image), without calling the LLM', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from('%PDF-1.4 scanned-image-only'),
      headers: { 'content-type': 'application/pdf' },
    })
    buildPdfParseMock('')

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [UNREADABLE_PAGE_REASON],
    })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('treats a near-empty fetched page body as unreadable (failed), not transient', async () => {
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: Buffer.from('   '),
      headers: {},
    })

    const result = await service.validate(params)

    expect(result).toEqual({
      outcome: 'failed',
      reasons: [UNREADABLE_PAGE_REASON],
    })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('treats an LLM failure as transient, never as a rejection', async () => {
    llm.jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
  })
})
