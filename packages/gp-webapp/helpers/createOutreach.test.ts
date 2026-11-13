import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reportClientError } from '@shared/observability/reportClientError'
import { createOutreach as createOutreachApi } from 'gpApi/outreach.api'
import type { CreateOutreachPayload } from 'gpApi/outreach.api'
import { createOutreach } from './createOutreach'

vi.mock('gpApi/outreach.api', () => ({ createOutreach: vi.fn() }))
vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
}))

const payload = {
  campaignId: 1,
  outreachType: 'p2p',
  draft: true,
} as CreateOutreachPayload

describe('createOutreach', () => {
  beforeEach(() => {
    vi.mocked(reportClientError).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('reports a request that never got an answer as an error', async () => {
    const failure = new TypeError('Failed to fetch')
    vi.mocked(createOutreachApi).mockRejectedValue(failure)
    const image = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' })

    expect(await createOutreach(payload, image)).toBeNull()
    expect(reportClientError).toHaveBeenCalledWith(failure, {
      context: 'createOutreach',
      outreachType: 'p2p',
      hasImage: true,
      imageBytes: image.size,
    })
  })

  it('leaves a server refusal to the caller, not error reporting', async () => {
    vi.mocked(createOutreachApi).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      data: { message: 'Refused' } as never,
    })
    const onRejected = vi.fn()

    expect(await createOutreach(payload, null, onRejected)).toBeNull()
    expect(onRejected).toHaveBeenCalledWith('Refused')
    expect(reportClientError).not.toHaveBeenCalled()
  })
})
