import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { describe, it, vi, beforeEach, expect } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { PinoLogger } from 'nestjs-pino'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { FileUpload } from '@/files/files.types'
import {
  CampaignPlanSharesService,
  MAX_SHARES_PER_CAMPAIGN,
} from './campaignPlanShares.service'

const UUID_PDF = /^[0-9a-f-]{36}\.pdf$/
const TEST_BUCKET = 'test-bucket'

describe('CampaignPlanSharesService', () => {
  let s3: {
    listKeys: ReturnType<typeof vi.fn>
    uploadFile: ReturnType<typeof vi.fn>
    getFileBytes: ReturnType<typeof vi.fn>
  }
  let service: CampaignPlanSharesService

  const file = {
    data: Buffer.from('%PDF-1.7 fake'),
    filename: 'campaign-plan.pdf',
    mimetype: 'application/pdf',
  } as unknown as FileUpload

  beforeEach(() => {
    process.env.CAMPAIGN_PLAN_SHARES_BUCKET = TEST_BUCKET
    process.env.API_PUBLIC_ROOT_URL = 'https://api.test'
    s3 = {
      listKeys: vi.fn().mockResolvedValue([]),
      uploadFile: vi.fn().mockResolvedValue('https://unused'),
      getFileBytes: vi.fn(),
    }
    const logger = {
      setContext: vi.fn(),
      info: vi.fn(),
    } as unknown as PinoLogger
    service = new CampaignPlanSharesService(s3 as unknown as S3Service, logger)
  })

  describe('createShare', () => {
    it('throws 503 when the bucket env var is unset', async () => {
      delete process.env.CAMPAIGN_PLAN_SHARES_BUCKET
      await expect(service.createShare(7, file)).rejects.toThrow(
        ServiceUnavailableException,
      )
      expect(s3.uploadFile).not.toHaveBeenCalled()
    })

    it('throws 503 when the root url var is unset', async () => {
      delete process.env.API_PUBLIC_ROOT_URL
      await expect(service.createShare(7, file)).rejects.toThrow(
        ServiceUnavailableException,
      )
      expect(s3.uploadFile).not.toHaveBeenCalled()
    })

    it('normalizes a trailing slash in the root url', async () => {
      process.env.API_PUBLIC_ROOT_URL = 'https://api.test/'
      const { url } = await service.createShare(7, file)
      expect(url).toMatch(/^https:\/\/api\.test\/v1\/campaign-plan-shares\//)
    })

    it('rejects content that is not actually a pdf', async () => {
      const fakePdf = {
        ...file,
        data: Buffer.from('<html>not a pdf</html>'),
      } as unknown as FileUpload
      await expect(service.createShare(7, fakePdf)).rejects.toThrow(
        BadRequestException,
      )
      expect(s3.uploadFile).not.toHaveBeenCalled()
    })

    it('rejects when the campaign is at the share cap', async () => {
      s3.listKeys.mockResolvedValue(
        Array.from({ length: MAX_SHARES_PER_CAMPAIGN }, (_, i) => `7/${i}.pdf`),
      )
      await expect(service.createShare(7, file)).rejects.toThrow(
        BadRequestException,
      )
      expect(s3.uploadFile).not.toHaveBeenCalled()
    })

    it('uploads under {campaignId}/{uuid}.pdf and returns the share url', async () => {
      const { url } = await service.createShare(7, file)

      expect(s3.listKeys).toHaveBeenCalledWith(TEST_BUCKET, '7/')
      const [bucket, body, key, options] = firstOrThrow(
        s3.uploadFile.mock.calls,
      )
      expect(bucket).toBe(TEST_BUCKET)
      expect(body).toBe(file.data)
      expect(key).toMatch(/^7\/[0-9a-f-]{36}\.pdf$/)
      expect(options).toEqual({ contentType: 'application/pdf' })
      expect(url).toBe(`https://api.test/v1/campaign-plan-shares/${key}`)
      expect(key.split('/')[1]).toMatch(UUID_PDF)
    })
  })

  describe('getSharePdf', () => {
    it('returns the buffer when the object exists', async () => {
      const pdf = Buffer.from('%PDF-1.7 stored')
      s3.getFileBytes.mockResolvedValue(pdf)
      const result = await service.getSharePdf('7', 'abc.pdf')
      expect(s3.getFileBytes).toHaveBeenCalledWith(TEST_BUCKET, '7/abc.pdf')
      expect(result).toBe(pdf)
    })

    it('returns null when the object is missing', async () => {
      s3.getFileBytes.mockResolvedValue(undefined)
      expect(await service.getSharePdf('7', 'abc.pdf')).toBeNull()
    })

    it('throws 503 when the bucket is unconfigured', async () => {
      delete process.env.CAMPAIGN_PLAN_SHARES_BUCKET
      await expect(service.getSharePdf('7', 'abc.pdf')).rejects.toThrow(
        ServiceUnavailableException,
      )
    })

    it('keeps serving issued links when only the root url var is missing', async () => {
      delete process.env.API_PUBLIC_ROOT_URL
      const pdf = Buffer.from('%PDF-1.7 stored')
      s3.getFileBytes.mockResolvedValue(pdf)
      expect(await service.getSharePdf('7', 'abc.pdf')).toBe(pdf)
    })
  })
})
