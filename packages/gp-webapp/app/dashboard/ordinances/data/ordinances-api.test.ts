import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadOrdinanceExport } from './ordinances-api'
import { OrdinanceExportError } from './exportError'

const mocks = vi.hoisted(() => ({ reportErrorToSentry: vi.fn() }))

vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: mocks.reportErrorToSentry,
}))
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/cookieHelper', () => ({ getCookie: () => 'org-1' }))

const PDF = 'application/pdf'
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const fileResponse = (
  body: BlobPart | null,
  contentType: string,
  init: ResponseInit = {},
) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
    ...init,
  })

const failure = async (format: 'pdf' | 'docx' = 'pdf') => {
  const error = await downloadOrdinanceExport('my-slug', format).catch(
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(OrdinanceExportError)
  return error as OrdinanceExportError
}

describe('downloadOrdinanceExport', () => {
  const fetchMock = vi.fn()
  const click = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    mocks.reportErrorToSentry.mockReset()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
    click.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['pdf', PDF],
    ['docx', DOCX],
  ] as const)('saves a %s file', async (format, type) => {
    fetchMock.mockResolvedValue(fileResponse('abc', type))
    await downloadOrdinanceExport('my-slug', format)
    expect(click).toHaveBeenCalledTimes(1)
    expect(mocks.reportErrorToSentry).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/ordinances/my-slug/export?format=${format}`,
    )
  })

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await failure()
    expect(error.kind).toBe('network')
    expect(error.message).toMatch(/could not reach the server/i)
    expect(mocks.reportErrorToSentry).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ slug: 'my-slug', format: 'pdf' }),
    )
  })

  it.each([
    [401, 'unauthorized', /session has expired/i],
    [403, 'forbidden', /do not have permission/i],
    [404, 'not-found', /could not be found/i],
    [502, 'server', /error 502/i],
    [418, 'http', /error 418: teapot/i],
  ])('maps HTTP %i', async (status, kind, message) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'teapot' }), { status }),
    )
    const error = await failure()
    expect(error.kind).toBe(kind)
    expect(error.message).toMatch(message)
    expect(error.details.status).toBe(status)
    expect(error.details.serverMessage).toBe('teapot')
    expect(mocks.reportErrorToSentry).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ status, slug: 'my-slug', format: 'pdf' }),
    )
  })

  it('handles a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 503 }))
    const error = await failure()
    expect(error.kind).toBe('server')
    expect(error.details.serverMessage).toBeUndefined()
  })

  it('rejects the wrong content type', async () => {
    fetchMock.mockResolvedValue(fileResponse('<html>', 'text/html'))
    const error = await failure('docx')
    expect(error.kind).toBe('wrong-type')
    expect(error.details.contentType).toBe('text/html')
    expect(click).not.toHaveBeenCalled()
  })

  it('rejects an empty file', async () => {
    fetchMock.mockResolvedValue(fileResponse(null, PDF))
    const error = await failure()
    expect(error.kind).toBe('empty')
    expect(click).not.toHaveBeenCalled()
  })

  it('reports a body that fails mid-download', async () => {
    const res = fileResponse('abc', PDF)
    vi.spyOn(res, 'blob').mockRejectedValue(new TypeError('network error'))
    fetchMock.mockResolvedValue(res)
    const error = await failure()
    expect(error.kind).toBe('network')
    expect(error.message).toMatch(/interrupted/i)
  })
})
