import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
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

  beforeEach(async () => {
    mockPrisma = {
      campaignStory: { upsert: vi.fn(), update: vi.fn() },
    }
    const module = await Test.createTestingModule({
      providers: [
        CampaignStoryService,
        { provide: PrismaService, useValue: mockPrisma },
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
})
