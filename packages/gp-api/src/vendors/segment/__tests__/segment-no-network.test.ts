import { describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SegmentService } from '../segment.service'

const segmentCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url instanceof Request ? url.url : url).startsWith(
      'https://api.segment.io/',
    ),
  )

// A test run's Segment batch used to flush on its timer during whatever file
// came next in the worker, and its retries landed on that file's fetch stub.
describe('SegmentService under test', () => {
  it('never posts a batch to Segment', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const service = new SegmentService(createMockLogger())

    await service.trackEvent(1, 'Some Event')
    await service['analytics'].closeAndFlush()

    expect(segmentCalls(fetchMock)).toHaveLength(0)
  })
})
