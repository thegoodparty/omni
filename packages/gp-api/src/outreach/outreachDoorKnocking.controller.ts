import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  DoorKnockingTalkingPointsDraftResponse,
  DoorKnockingTalkingPointsDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { describeFilterForTalkingPoints } from '@/contacts/utils/describeFilter.util'
import { Campaign, Organization, User } from '../generated/prisma'
import {
  OutreachDoorKnockingGenerationService,
  WIN_DOOR_KNOCKING_VOICE,
} from './services/outreachDoorKnockingGeneration.service'
import { OutreachComposeContextService } from './services/outreachComposeContext.service'
import {
  DoorKnockingTalkingPointsDraftRequest,
  DoorKnockingTalkingPointsDraftRequestSchema,
} from './schemas/DoorKnockingTalkingPointsDraft.schema'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Stateless, like every other compose draft endpoint: nothing persists here.
// The create flow holds the points client-side and freezes them onto
// Outreach.script through POST /v1/door-knocking/turfs.
//
// That separation is not incidental. The turf create transaction already
// carries a paid Geoapify round trip inside a 120-second window, and an LLM
// call has no business inside it — see doorKnockingCreate.service.
@Controller('outreach')
@UseCampaign()
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachDoorKnockingController {
  constructor(
    private readonly generationService: OutreachDoorKnockingGenerationService,
    private readonly composeContext: OutreachComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly contacts: ContactsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachDoorKnockingController.name)
  }

  @Post('door-knocking/draft')
  @ResponseSchema(DoorKnockingTalkingPointsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(DoorKnockingTalkingPointsDraftRequestSchema))
    input: DoorKnockingTalkingPointsDraftRequest,
  ): Promise<DoorKnockingTalkingPointsDraftResponse> {
    await this.contacts.assertProAccess(organization)

    // Office is prompt enrichment, same as the phone-banking draft: an
    // election-api failure degrades to the fallback chain rather than failing
    // the request.
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

    // The one caller that reads the issue store current onboarding writes to.
    // Opt-in rather than the default because turning it on for everyone would
    // change what four shipped channels generate — see the `issues` block in
    // outreachComposeContext.service.ts. The Context section is the one line
    // on this card that is worth nothing without issue material, which is why
    // door knocking is the channel that needs it most.
    const campaignContext = await this.composeContext.buildCampaignContext(
      campaign,
      { includeWebsiteIssues: true },
    )

    return this.generationService.generateDraft({
      input,
      name: candidateName(user),
      office: positionName ?? campaign.details.normalizedOffice ?? '',
      userId: String(user.id),
      extraContext: campaignContext,
      // Deliberately NOT the full filter description. The allowlist keeps
      // party and the targeting mechanics out of the prompt entirely, rather
      // than passing them in beside a rule forbidding their use — see
      // describeFilter.util.
      audienceDescription: describeFilterForTalkingPoints(input.filters, {
        isServe: false,
      }),
      voice: WIN_DOOR_KNOCKING_VOICE,
    })
  }
}
