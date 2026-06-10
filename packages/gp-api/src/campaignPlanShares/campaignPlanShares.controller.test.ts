import { HttpStatus } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCampaignGuard } from '@/campaigns/guards/UseCampaign.guard'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignPlanSharesController } from './campaignPlanShares.controller'
import { CampaignPlanSharesRateLimitGuard } from './guards/campaignPlanSharesRateLimit.guard'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

const VALID_UUID_PDF = '0f1e2d3c-4b5a-4978-8765-43210fedcba9.pdf'

describe('CampaignPlanSharesController', () => {
  let controller: CampaignPlanSharesController
  const service = {
    createShare: vi.fn(),
    getSharePdf: vi.fn(),
  }

  const makeReply = () => {
    const reply = {
      status: vi.fn(),
      type: vi.fn(),
    }
    reply.status.mockReturnValue(reply)
    reply.type.mockReturnValue(reply)
    return reply
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CampaignPlanSharesController],
      providers: [
        { provide: CampaignPlanSharesService, useValue: service },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    })
      .overrideGuard(CampaignPlanSharesRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UseCampaignGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = moduleRef.get(CampaignPlanSharesController)
  })

  describe('getSharePdf', () => {
    it('returns 404 html for a malformed file name without touching s3', async () => {
      const reply = makeReply()
      const result = await controller.getSharePdf(
        '7',
        'not-a-uuid.pdf',
        reply as never,
      )
      expect(service.getSharePdf).not.toHaveBeenCalled()
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
      expect(String(result)).toContain('no longer available')
    })

    it('returns 404 html when the object is missing', async () => {
      service.getSharePdf.mockResolvedValue(null)
      const reply = makeReply()
      const result = await controller.getSharePdf(
        '7',
        VALID_UUID_PDF,
        reply as never,
      )
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
      expect(String(result)).toContain('no longer available')
    })

    it('streams the pdf when found', async () => {
      service.getSharePdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
      const reply = makeReply()
      const result = await controller.getSharePdf(
        '7',
        VALID_UUID_PDF,
        reply as never,
      )
      expect(service.getSharePdf).toHaveBeenCalledWith('7', VALID_UUID_PDF)
      expect(reply.status).not.toHaveBeenCalled()
      expect(result.constructor.name).toBe('StreamableFile')
    })
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
