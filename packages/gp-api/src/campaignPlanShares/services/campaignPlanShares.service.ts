import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { MimeTypes } from 'http-constants-ts'
import { PinoLogger } from 'nestjs-pino'
import { FileUpload } from '@/files/files.types'
import { getEnv } from '@/shared/util/env.util'
import { S3Service } from '@/vendors/aws/services/s3.service'

export const MAX_SHARES_PER_CAMPAIGN = 100

// The interceptor's mimeTypes option only checks the client-declared part
// header; this checks the actual bytes so non-PDF content can't be stored
// and served back as application/pdf.
const PDF_MAGIC = '%PDF-'

@Injectable()
export class CampaignPlanSharesService {
  constructor(
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignPlanSharesService.name)
  }

  // Read per-call (not import-time) so an unconfigured environment (e.g. a
  // local .env without the vars) fails with a clean 503 instead of crashing
  // at boot, and so tests can toggle the vars.
  private requireBucket(): string {
    const bucket = getEnv('CAMPAIGN_PLAN_SHARES_BUCKET')
    if (!bucket) {
      throw new ServiceUnavailableException(
        'Campaign plan sharing is not enabled in this environment',
      )
    }
    return bucket
  }

  // Only link creation needs the public root URL — serving must keep working
  // for already-issued links even if this var is lost in a config refactor.
  private requireApiRootUrl(): string {
    const apiRootUrl = getEnv('API_PUBLIC_ROOT_URL')
    if (!apiRootUrl) {
      throw new ServiceUnavailableException(
        'Campaign plan sharing is not enabled in this environment',
      )
    }
    return apiRootUrl.replace(/\/+$/, '')
  }

  async createShare(
    campaignId: number,
    file: FileUpload,
  ): Promise<{ url: string }> {
    const bucket = this.requireBucket()
    const apiRootUrl = this.requireApiRootUrl()

    if (
      !Buffer.isBuffer(file.data) ||
      !file.data.subarray(0, PDF_MAGIC.length).toString().startsWith(PDF_MAGIC)
    ) {
      throw new BadRequestException('File is not a PDF')
    }

    const existingKeys = await this.s3.listKeys(bucket, `${campaignId}/`)
    if (existingKeys.length >= MAX_SHARES_PER_CAMPAIGN) {
      throw new BadRequestException('Share limit reached for this campaign')
    }

    const key = `${campaignId}/${randomUUID()}.pdf`
    await this.s3.uploadFile(bucket, file.data, key, {
      contentType: MimeTypes.APPLICATION_PDF,
    })
    this.logger.info({ campaignId }, 'created campaign plan share')
    return { url: `${apiRootUrl}/v1/campaign-plan-shares/${key}` }
  }

  async getSharePdf(
    campaignId: string,
    fileName: string,
  ): Promise<Buffer | null> {
    const bucket = this.requireBucket()
    const bytes = await this.s3.getFileBytes(
      bucket,
      `${campaignId}/${fileName}`,
    )
    return bytes ?? null
  }
}
