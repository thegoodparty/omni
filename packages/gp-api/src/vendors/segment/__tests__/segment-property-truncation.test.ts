import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SegmentService } from '../segment.service'

const mockTrack = vi.fn().mockResolvedValue(undefined)

vi.mock('@segment/analytics-node', () => ({
  default: class {
    track = mockTrack
  },
}))

describe('SegmentService.trackEvent property truncation', () => {
  let service: SegmentService

  beforeEach(() => {
    process.env.SEGMENT_WRITE_KEY = 'test-key'
    service = new SegmentService(createMockLogger())
  })

  it('truncates string properties longer than 256 chars', async () => {
    const longSummary = 'a'.repeat(500)

    const result = await service.trackEvent(1, 'Some Event', {
      trendingIssue1Summary: longSummary,
    })

    const value = result.properties?.trendingIssue1Summary as string
    expect(value).toHaveLength(256)
    expect(value.endsWith('...')).toBe(true)
  })

  it('leaves short strings and non-string values untouched', async () => {
    const result = await service.trackEvent(1, 'Some Event', {
      title: 'A short title',
      topIssueCount: 2,
      priority: 'high',
    })

    expect(result.properties).toMatchObject({
      title: 'A short title',
      topIssueCount: 2,
      priority: 'high',
    })
  })

  it('keeps a string exactly at the 256 limit unchanged', async () => {
    const exact = 'b'.repeat(256)

    const result = await service.trackEvent(1, 'Some Event', {
      summary: exact,
    })

    expect(result.properties?.summary).toBe(exact)
  })
})
