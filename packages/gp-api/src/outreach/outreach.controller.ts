import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { Campaign, Organization, OutreachType, User } from '../generated/prisma'
import { CacheControls, MimeTypes } from 'http-constants-ts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from 'src/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from 'src/campaigns/decorators/UseCampaign.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ContactsService } from '@/contacts/services/contacts.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from 'src/shared/util/appEnvironment.util'
import { FilesInterceptor } from 'src/files/interceptors/files.interceptor'
import { CreateOutreachSchema } from './schemas/createOutreachSchema'
import { OutreachNotificationInterceptor } from './interceptors/outreachNotification.interceptor'
import { OutreachService } from './services/outreach.service'
import { PinoLogger } from 'nestjs-pino'

@Controller('outreach')
@UsePipes(ZodValidationPipe)
@UseInterceptors(OutreachNotificationInterceptor)
export class OutreachController {
  constructor(
    private readonly outreachService: OutreachService,
    private readonly s3: S3Service,
    private readonly contacts: ContactsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachController.name)
  }

  @Post()
  @UseCampaign()
  @UseOrganization()
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
  async create(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body() createOutreachDto: CreateOutreachSchema,
    @ReqFile() image?: FileUpload,
  ) {
    if (campaign.id !== createOutreachDto.campaignId) {
      throw new UnauthorizedException('Campaign ID mismatch')
    }

    const { outreachType, date } = createOutreachDto

    // Texting is a paid channel, so every p2p write — a fresh create and a
    // draft resume alike — needs the Pro gate the robocall create carries.
    // filterAccessCheck below only fires when a saved list rides along, which
    // a resume body need not carry.
    if (outreachType === OutreachType.p2p) {
      await this.contacts.assertProAccess(organization)
    }

    // Resuming a saved draft: the row already holds the image the candidate
    // uploaded, so the client sends no file — and an unexpected one is
    // ignored rather than uploaded, which would orphan a second object.
    const isDraftConversion =
      outreachType === OutreachType.p2p && !!createOutreachDto.draftOutreachId

    const requiresImage =
      !isDraftConversion &&
      (outreachType === OutreachType.text || outreachType === OutreachType.p2p)
    if (requiresImage) {
      if (!image) {
        throw new BadRequestException(
          `Image is required for ${outreachType} outreach campaigns`,
        )
      }
      if (
        outreachType === OutreachType.p2p &&
        (!image.filename || !image.mimetype)
      ) {
        throw new BadRequestException(
          'Image filename and MIME type are required for P2P outreach',
        )
      }
    }

    const imageUrl =
      image && !isDraftConversion
        ? await this.s3.uploadFile(
            ASSET_DOMAIN,
            image.data,
            this.s3.buildKey(
              `scheduled-campaign/${campaign.slug}/${outreachType}/${date}`,
              image.filename,
            ),
            {
              contentType: image.mimetype,
              cacheControl: `${CacheControls.MAX_AGE}=${31_536_000}`,
              baseUrl: `https://${ASSET_DOMAIN}`,
            },
          )
        : undefined

    if (outreachType === OutreachType.p2p && !imageUrl && !isDraftConversion) {
      throw new BadRequestException('Failed to upload image for P2P outreach')
    }

    return this.outreachService.create(
      user,
      campaign,
      createOutreachDto,
      imageUrl,
    )
  }

  // Reads nothing but our own database, deliberately.
  //
  // This list used to decorate each texting row with the vendor's live view of
  // the job, fetched from Peerly on every page load, and it would not render at
  // all if that fetch failed: on 2026-10-01 a five-minute Peerly wobble left
  // three candidates with no outreach page — no texts, no door knocking, no
  // phone banking, no robocalls — most of them waiting ~13 seconds for a
  // response that never came.
  //
  // Nothing on the page needed the vendor to be up. The hourly completion sweep
  // already reads each open job from Peerly and ratchets `status` forward, so
  // the status column is a projection of columns we hold: `status`, the send
  // instant in `date`, and `projectId` for whether a vendor job exists at all.
  // The vendor stays on the sweep's path, where a failed read delays a label by
  // an hour instead of blanking a dashboard.
  @Get()
  @UseCampaign()
  async findAll(@ReqCampaign() campaign: Campaign) {
    return this.outreachService.findByCampaignId(campaign.id)
  }
}
