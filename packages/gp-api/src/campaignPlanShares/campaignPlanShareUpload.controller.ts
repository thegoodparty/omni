import {
  BadRequestException,
  Controller,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import { MimeTypes } from 'http-constants-ts'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Campaign } from '../generated/prisma'
import { CreateCampaignPlanShareOutputSchema } from './schemas/createCampaignPlanShare.schema'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

const MAX_PDF_BYTES = 15_000_000

// Lives under /v1/campaigns (not /v1/campaign-plan-shares) because creation
// is scoped to the caller's campaign; serving stays in the sibling public
// controller. Split files because the route-type generator requires one
// string-literal @Controller prefix per controller.
@Controller('campaigns')
export class CampaignPlanShareUploadController {
  constructor(private readonly shares: CampaignPlanSharesService) {}

  @Post('mine/plan-pdf-share')
  @UseCampaign()
  @UseInterceptors(
    ZodResponseInterceptor,
    FilesInterceptor('file', {
      mode: 'buffer',
      sizeLimit: MAX_PDF_BYTES,
      mimeTypes: [MimeTypes.APPLICATION_PDF],
    }),
  )
  @ResponseSchema(CreateCampaignPlanShareOutputSchema)
  async createShare(
    @ReqCampaign() campaign: Campaign,
    @ReqFile() file?: FileUpload,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('No file found')
    }
    return this.shares.createShare(campaign.id, file)
  }
}
