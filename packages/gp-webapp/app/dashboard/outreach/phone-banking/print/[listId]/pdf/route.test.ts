import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from 'ofetch'
import JSZip from 'jszip'

const { mockCandidateAccess, mockServerRequest } = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockServerRequest: vi.fn(),
}))

vi.mock('app/dashboard/shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('gpApi/server-request', () => ({
  serverRequest: (route: string, payload: unknown) =>
    mockServerRequest(route, payload),
}))

import { GET } from './route'

const ROUTE = 'GET /v1/phone-banking/lists/:id'

const buildEntry = (
  overrides: Partial<{
    id: number
    seq: number
    sheetIndex: number
    phone: string
  }> = {},
) => ({
  id: 1,
  seq: 1,
  sheetIndex: 1,
  phone: '3125550101',
  persons: [
    {
      personId: 'person-1',
      name: 'Dorian Fen',
      age: 31,
      party: 'Independent',
      address: '105 Elm St',
      cellPhone: '3125550101',
      landline: null,
      interaction: null,
    },
  ],
  ...overrides,
})

const buildList = (
  entries = [buildEntry()],
  overrides: Record<string, unknown> = {},
) => ({
  id: 7,
  name: 'Elm & Cedar',
  script: 'Hi, this is a volunteer calling about the election.',
  sheetCount: 1,
  purpose: 'introduce',
  createdAt: new Date('2026-07-21T00:00:00Z'),
  entries,
  ...overrides,
})

const fetchError = (status: number): FetchError => {
  const error = new FetchError(`HTTP ${status}`)
  error.status = status
  return error
}

const get = (listId: string, search = '') =>
  GET(new Request(`https://app.test/x/${listId}/pdf${search}`), {
    params: Promise.resolve({ listId }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockServerRequest.mockImplementation((route: string) => {
    if (route === ROUTE) return Promise.resolve({ data: buildList() })
    return Promise.reject(new Error(`unexpected route ${route}`))
  })
})

describe('call sheet PDF route', () => {
  it('serves a PDF named after the list for a single-sheet list', async () => {
    const response = await get('7')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="elm-cedar---phone-bank---\d{2}-\d{2}-\d{4}-list-1-of-1\.pdf"$/,
    )
    // A call sheet is voter data and goes stale the moment a call is logged.
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const body = Buffer.from(await response.arrayBuffer())
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  // The list is dense voter PII, so the auth gate has to run before anything
  // is fetched, not alongside it.
  it('honors the candidateAccess gate without fetching', async () => {
    mockCandidateAccess.mockRejectedValue(new Error('redirect:/sign-up'))

    await expect(get('7')).rejects.toThrow('redirect:/sign-up')
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('404s a list that is not yours, or does not exist', async () => {
    mockServerRequest.mockRejectedValue(fetchError(404))

    expect((await get('7')).status).toBe(404)
  })

  // gp-api parses the id with ParseIntPipe, which 400s rather than 404s.
  it('404s a non-numeric id without calling the API', async () => {
    expect((await get('foo')).status).toBe(404)
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('lets a server failure surface instead of claiming the list is missing', async () => {
    mockServerRequest.mockRejectedValue(fetchError(500))

    await expect(get('7')).rejects.toBeInstanceOf(FetchError)
  })

  it('serves just the requested sheet for ?sheet=N', async () => {
    const entries = [
      buildEntry({ id: 1, seq: 1, sheetIndex: 1 }),
      buildEntry({ id: 2, seq: 61, sheetIndex: 2, phone: '3125550102' }),
    ]
    mockServerRequest.mockResolvedValue({
      data: buildList(entries, { sheetCount: 2 }),
    })

    const response = await get('7', '?sheet=2')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toMatch(
      /list-2-of-2\.pdf"$/,
    )
  }, 30_000)

  it('404s a ?sheet= value that does not exist on the list', async () => {
    const response = await get('7', '?sheet=9')

    expect(response.status).toBe(404)
  })

  // A 3-sheet list with no ?sheet= param returns a ZIP of all three,
  // correctly named.
  it('zips every sheet when the list spans more than one, and none has a param', async () => {
    const entries = [1, 2, 3].map((sheetIndex) =>
      buildEntry({
        id: sheetIndex,
        seq: (sheetIndex - 1) * 60 + 1,
        sheetIndex,
        phone: `312555010${sheetIndex}`,
      }),
    )
    mockServerRequest.mockResolvedValue({
      data: buildList(entries, { sheetCount: 3 }),
    })

    const response = await get('7')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="elm-cedar---phone-bank---\d{2}-\d{2}-\d{4}\.zip"$/,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    const names = Object.keys(zip.files).sort()
    expect(names).toHaveLength(3)
    for (const name of names) {
      expect(name).toMatch(
        /^elm-cedar---phone-bank---\d{2}-\d{2}-\d{4}-list-[123]-of-3\.pdf$/,
      )
      const file = await zip.files[name]?.async('nodebuffer')
      expect(file?.subarray(0, 5).toString()).toBe('%PDF-')
    }
  }, 60_000)
})
