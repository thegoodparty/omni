import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  SmsDraftRequest,
  SmsDraftRequestSchema,
  SmsDraftResponse,
  SmsDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { Campaign, User } from '../generated/prisma'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

@Controller('outreach')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachSmsController {
  constructor(
    private readonly generationService: OutreachSmsGenerationService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSmsController.name)
  }

  @Post('sms/draft')
  @ResponseSchema(SmsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SmsDraftRequestSchema))
    input: SmsDraftRequest,
  ): Promise<SmsDraftResponse> {
    // Same office-resolution posture as the social draft: the position
    // name lives on the org's election-api position; a failure there
    // degrades to the details fallback instead of failing the draft.
    let positionName: string | null = null
    if (campaign.organizationSlug) {
      try {
        positionName =
          await this.organizations.resolvePositionNameByOrganizationSlug(
            campaign.organizationSlug,
          )
      } catch (err) {
        this.logger.warn({ err }, 'position resolution failed for draft')
      }
    }
    return {
      draft: await this.generationService.generateDraft(
        input,
        candidateName(user),
        positionName ?? campaign.details.normalizedOffice ?? '',
        String(user.id),
      ),
    }
  }
}
