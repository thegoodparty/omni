import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import * as dns from 'node:dns'
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

const mockedAxiosGet = vi.mocked(axios.get)
const mockedDnsLookup = vi.mocked(dns.lookup)

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

describe('CvPreSubmissionValidationService', () => {
  let service: CvPreSubmissionValidationService
  let llm: { jsonCompletion: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    llm = { jsonCompletion: vi.fn() }
    stubDnsLookup(publicAddress)
    mockedAxiosGet.mockResolvedValue({
      status: 200,
      data: '<html><body>Jane Candidate filed for office. Filing on record.</body></html>',
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
  it('treats a filing-page fetch failure as transient, never as a rejection', async () => {
    mockedAxiosGet.mockRejectedValue(new Error('ECONNRESET'))

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('treats an empty fetched page body as transient', async () => {
    mockedAxiosGet.mockResolvedValue({ status: 200, data: '   ' })

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
    expect(llm.jsonCompletion).not.toHaveBeenCalled()
  })

  it('treats an LLM failure as transient, never as a rejection', async () => {
    llm.jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const result = await service.validate(params)

    expect(result).toEqual({ outcome: 'transient' })
  })
})
