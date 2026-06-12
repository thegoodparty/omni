import { HttpStatus, StreamableFile } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CampaignPlanSharesController } from './campaignPlanShares.controller'
import { CampaignPlanSharesRateLimitGuard } from './guards/campaignPlanSharesRateLimit.guard'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

const VALID_UUID_PDF = '0f1e2d3c-4b5a-4978-8765-43210fedcba9.pdf'
const NOT_FOUND_COPY = 'no longer available'

describe('CampaignPlanSharesController', () => {
  let controller: CampaignPlanSharesController
  const service = {
    getSharePdf: vi.fn(),
  }

  const makeReply = () => {
    const reply = {
      header: vi.fn(),
      status: vi.fn(),
      type: vi.fn(),
    }
    reply.header.mockReturnValue(reply)
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
      expect(String(result)).toContain(NOT_FOUND_COPY)
    })

    it('returns 404 html for a malformed campaign id without touching s3', async () => {
      const reply = makeReply()
      const result = await controller.getSharePdf(
        'not-a-number',
        VALID_UUID_PDF,
        reply as never,
      )
      expect(service.getSharePdf).not.toHaveBeenCalled()
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND)
      expect(String(result)).toContain(NOT_FOUND_COPY)
    })

    it('keeps every response out of shared caches', async () => {
      service.getSharePdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
      const reply = makeReply()
      await controller.getSharePdf('7', VALID_UUID_PDF, reply as never)
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store',
      )
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
      expect(String(result)).toContain(NOT_FOUND_COPY)
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
      expect(result).toBeInstanceOf(StreamableFile)
    })
  })
})
