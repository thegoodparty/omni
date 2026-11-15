import { describe, expect, it, vi } from 'vitest'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'

describe('deriveBillableCount', () => {
  it('counts distinct dialable numbers for the landline list', async () => {
    process.env.ROBOCALL_AUDIO_BUCKET = 'test-bucket'
    const findContactsForFilter = vi
      .fn()
      .mockResolvedValue({ pagination: { totalResults: 42 } })
    const voterFileFilterService = {
      findByIdAndOrganizationSlug: vi.fn().mockResolvedValue({ id: 7 }),
    }
    const service = new OutreachRobocallService(
      { findContactsForFilter } as never,
      voterFileFilterService as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const organization = { slug: 'org-1' } as never
    const count = await service.deriveBillableCount(organization, 7)

    expect(count).toBe(42)
    expect(findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ hasLandline: true }),
      expect.objectContaining({ distinctLandline: true }),
      organization,
    )
  })
})
