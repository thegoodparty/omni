import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRobocallDraft } from './createOutreachDraft'

// A real fetch stub rather than a mocked API module: the point is that the
// typed route (ofetch.raw) throws a FetchError on the server's 409, and the
// helper reads the existing draft id off that error.
const fetchMock = vi.fn()

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const payload = {
  outreachType: 'robocall',
  name: 'Saved call',
  audienceRequest: {},
  audioKey: 'robocall/118/clip.mp3',
  callbackNumber: '+15555550100',
} as unknown as Parameters<typeof createRobocallDraft>[0]

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

describe('createRobocallDraft', () => {
  it('returns the saved draft on a 201', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { id: 29, outreachType: 'robocall' }),
    )

    const result = await createRobocallDraft(payload)

    expect(result.conflictId).toBeNull()
    expect(result.draft).toMatchObject({ id: 29 })
  })

  it('resumes the existing draft when the server answers 409', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        existingId: 28,
        message: 'A robocall draft already exists',
      }),
    )

    const result = await createRobocallDraft(payload)

    expect(result).toEqual({ draft: null, conflictId: 28 })
  })

  it('reports no draft and no conflict on any other failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'boom' }))

    const result = await createRobocallDraft(payload)

    expect(result).toEqual({ draft: null, conflictId: null })
  })
})
