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
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Campaign } from '../generated/prisma'
import { OutreachRobocallAudioService } from './services/outreachRobocallAudio.service'

// Returns a presigned S3 POST (url + form fields) for the recorded robocall
// audio; nothing persists here — the client holds the returned key until the
// send is created later. Not Pro-gated (outreach-pro-gating-v2): a free
// candidate can build a robocall draft, including this presign, before
// upgrading. Only the paid create/authorize/send routes still require Pro.
@Controller('outreach')
@UseCampaign()
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachRobocallAudioController {
  constructor(private readonly audioService: OutreachRobocallAudioService) {}

  @Post('robocall/audio/presign')
  @ResponseSchema(RobocallAudioPresignResponseSchema)
  async presign(
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(RobocallAudioPresignRequestSchema))
    input: RobocallAudioPresignRequest,
  ): Promise<RobocallAudioPresignResponse> {
    return this.audioService.createUploadUrl(input, campaign.id)
  }
}
