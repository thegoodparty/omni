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

@Injectable()
export class CampaignPlanSharesService {
  constructor(
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignPlanSharesService.name)
  }

  // Read per-call (not import-time) so qa/prod — which deliberately have no
  // bucket yet — fail with a clean 503 instead of crashing at boot, and so
  // tests can toggle the vars.
  private requireConfig(): { bucket: string; apiRootUrl: string } {
    const bucket = getEnv('CAMPAIGN_PLAN_SHARES_BUCKET')
    const apiRootUrl = getEnv('API_PUBLIC_ROOT_URL')
    if (!bucket || !apiRootUrl) {
      throw new ServiceUnavailableException(
        'Campaign plan sharing is not enabled in this environment',
      )
    }
    return { bucket, apiRootUrl }
  }

  async createShare(
    campaignId: number,
    file: FileUpload,
  ): Promise<{ url: string }> {
    const { bucket, apiRootUrl } = this.requireConfig()

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
    const { bucket } = this.requireConfig()
    const bytes = await this.s3.getFileBytes(
      bucket,
      `${campaignId}/${fileName}`,
    )
    return bytes ?? null
  }
}
