import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCampaignGuard } from '@/campaigns/guards/UseCampaign.guard'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignPlanShareUploadController } from './campaignPlanShareUpload.controller'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

describe('CampaignPlanShareUploadController', () => {
  let controller: CampaignPlanShareUploadController
  const service = {
    createShare: vi.fn(),
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CampaignPlanShareUploadController],
      providers: [
        { provide: CampaignPlanSharesService, useValue: service },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    })
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = moduleRef.get(CampaignPlanShareUploadController)
  })

  describe('createShare', () => {
    it('400s when no file part was sent', async () => {
      await expect(
        controller.createShare({ id: 7 } as never, undefined),
      ).rejects.toThrow('No file found')
    })

    it('delegates to the service with the campaign id', async () => {
      service.createShare.mockResolvedValue({ url: 'https://x/1.pdf' })
      const file = { data: Buffer.from('%PDF') }
      const result = await controller.createShare(
        { id: 7 } as never,
        file as never,
      )
      expect(service.createShare).toHaveBeenCalledWith(7, file)
      expect(result).toEqual({ url: 'https://x/1.pdf' })
    })
  })
})
