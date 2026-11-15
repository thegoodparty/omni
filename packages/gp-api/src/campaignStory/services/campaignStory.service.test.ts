import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { JobsService } from '@/jobs/jobs.service'
import { CampaignStoryService } from './campaignStory.service'

const uniqueConstraintError = Object.assign(new Error('unique'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2002',
})

describe('CampaignStoryService.upsertForCampaign', () => {
  let service: CampaignStoryService
  let mockPrisma: {
    campaignStory: Record<'upsert' | 'update', ReturnType<typeof vi.fn>>
  }
  let jobs: { send: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockPrisma = {
      campaignStory: { upsert: vi.fn(), update: vi.fn() },
    }
    jobs = { send: vi.fn().mockResolvedValue('job-1') }
    const module = await Test.createTestingModule({
      providers: [
        CampaignStoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JobsService, useValue: jobs },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()
    service = module.get(CampaignStoryService)
  })

  it('applies the field as an update when the create races into P2002', async () => {
    mockPrisma.campaignStory.upsert.mockRejectedValue(uniqueConstraintError)
    mockPrisma.campaignStory.update.mockResolvedValue({
      background: 'b',
    })

    const result = await service.upsertForCampaign(99, { background: 'b' })

    expect(mockPrisma.campaignStory.update).toHaveBeenCalledWith({
      where: { campaignId: 99 },
      data: { background: 'b' },
    })
    expect(result).toEqual({ background: 'b' })
  })

  it('rethrows errors that are not unique-constraint violations', async () => {
    mockPrisma.campaignStory.upsert.mockRejectedValue(new Error('boom'))

    await expect(
      service.upsertForCampaign(99, { background: 'x' }),
    ).rejects.toThrow('boom')
    expect(mockPrisma.campaignStory.update).not.toHaveBeenCalled()
  })

  // The background is one of the three story answers, so a write may have just
  // completed the story and made an existing campaign plan stale.
  it('announces the write so the plan can regenerate', async () => {
    mockPrisma.campaignStory.upsert.mockResolvedValue({ background: 'b' })

    await service.upsertForCampaign(99, { background: 'b' })

    expect(jobs.send).toHaveBeenCalledWith(
      'campaignStoryCompleted',
      { campaignId: 99 },
      { group: '99' },
    )
  })

  it('still saves the story when the job cannot be sent', async () => {
    mockPrisma.campaignStory.upsert.mockResolvedValue({ background: 'b' })
    jobs.send.mockRejectedValue(new Error('db down'))

    await expect(
      service.upsertForCampaign(99, { background: 'b' }),
    ).resolves.toEqual({ background: 'b' })
  })

  it('does not announce a write that failed', async () => {
    mockPrisma.campaignStory.upsert.mockRejectedValue(new Error('boom'))

    await expect(
      service.upsertForCampaign(99, { background: 'x' }),
    ).rejects.toThrow('boom')
    expect(jobs.send).not.toHaveBeenCalled()
  })
})
