import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  RobocallAudioPresignRequest,
  RobocallAudioPresignRequestSchema,
  RobocallAudioPresignResponse,
  RobocallAudioPresignResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Campaign, Organization } from '../generated/prisma'
import { OutreachRobocallAudioService } from './services/outreachRobocallAudio.service'

// Returns a presigned S3 PUT URL for the recorded robocall audio. Pro-gated the
// same way as the robocall script draft; nothing persists here — the client
// holds the returned key until the send is created in a later step.
@Controller('outreach')
@UseCampaign()
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachRobocallAudioController {
  constructor(
    private readonly audioService: OutreachRobocallAudioService,
    private readonly contacts: ContactsService,
  ) {}

  @Post('robocall/audio/presign')
  @ResponseSchema(RobocallAudioPresignResponseSchema)
  async presign(
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(RobocallAudioPresignRequestSchema))
    input: RobocallAudioPresignRequest,
  ): Promise<RobocallAudioPresignResponse> {
    await this.contacts.assertProAccess(organization)

    return this.audioService.createUploadUrl(input, campaign.id)
  }
}
