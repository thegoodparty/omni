import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  CreateOutreachDraftRequest,
  CreateOutreachDraftRequestSchema,
  OutreachDetail,
  OutreachDetailSchema,
} from '@goodparty_org/contracts'
import { CacheControls, MimeTypes } from 'http-constants-ts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { Campaign } from '../generated/prisma'
import { OutreachDraftService } from './services/outreachDraft.service'

// Drafts deliberately live off OutreachController: that controller carries
// OutreachNotificationInterceptor, which Slacks CAS on a failure. A draft is
// not a send attempt, so a failure here must not page anyone — the same
// reasoning that keeps GET :id on the social controller. No Pro gate either:
// drafting is what a candidate who cannot send yet is here to do.
@Controller('outreach')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachDraftController {
  constructor(
    private readonly drafts: OutreachDraftService,
    private readonly s3: S3Service,
  ) {}

  // One route for both channels. p2p posts multipart (its image rides along);
  // a robocall draft has no file and may arrive as multipart or JSON — the
  // interceptor passes a non-multipart request straight through.
  @Post('drafts')
  @UseInterceptors(
    FilesInterceptor('file', {
      mode: 'buffer',
      mimeTypes: [
        MimeTypes.IMAGE_JPEG,
        MimeTypes.IMAGE_GIF,
        MimeTypes.IMAGE_PNG,
      ],
    }),
  )
  @ResponseSchema(OutreachDetailSchema)
  async create(
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(CreateOutreachDraftRequestSchema))
    body: CreateOutreachDraftRequest,
    @ReqFile() image?: FileUpload,
  ): Promise<OutreachDetail> {
    if (body.outreachType === 'p2p') {
      if (!image) {
        throw new BadRequestException('Image is required for a texting draft')
      }
      const imageUrl = await this.s3.uploadFile(
        ASSET_DOMAIN,
        image.data,
        // The send path's key embeds the send date; a draft has none.
        this.s3.buildKey(
          `scheduled-campaign/${campaign.slug}/p2p/draft`,
          image.filename,
        ),
        {
          contentType: image.mimetype,
          cacheControl: `${CacheControls.MAX_AGE}=${31_536_000}`,
          baseUrl: `https://${ASSET_DOMAIN}`,
        },
      )
      return this.drafts.createP2pDraft(campaign, body, imageUrl)
    }

    const { audioKey, callbackNumber } = body
    if (!audioKey || !callbackNumber) {
      throw new BadRequestException(
        'audioKey and callbackNumber are required for a robocall draft',
      )
    }
    // Same scoping check the paid robocall create makes: a caller must not
    // bind another campaign's recording to their draft.
    if (!audioKey.startsWith(`robocall/${campaign.id}/`)) {
      throw new BadRequestException('Audio does not belong to this campaign')
    }
    return this.drafts.createRobocallDraft(
      campaign,
      body,
      audioKey,
      callbackNumber,
    )
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.drafts.deleteDraft(campaign, id)
  }
}
