import { Body, Controller, Post, UseInterceptors } from '@nestjs/common'
import {
  DoorKnockingTalkingPointsDraftResponse,
  DoorKnockingTalkingPointsDraftResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { describeFilterForTalkingPoints } from '@/contacts/utils/describeFilter.util'
import { ElectedOffice, User } from '../generated/prisma'
import {
  OutreachDoorKnockingGenerationService,
  SERVE_DOOR_KNOCKING_VOICE,
} from './services/outreachDoorKnockingGeneration.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import {
  ServeDoorKnockingTalkingPointsDraftRequest,
  ServeDoorKnockingTalkingPointsDraftRequestSchema,
} from './schemas/DoorKnockingTalkingPointsDraft.schema'

const electedOfficialName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// Serve counterpart to OutreachDoorKnockingController: org-scoped, stateless.
// @UseElectedOffice is the server-side mirror of the webapp's serveAccess() —
// the client's chosen surface is never trusted, so ownership comes from the
// org's own ElectedOffice row (the guard's 404).
//
// Deliberately never touches CampaignsService or campaign.details: serve
// purposes carry no voting mechanics, and the win/serve isolation invariant
// holds here as it does on the phone-banking twin.
@Controller('outreach/serve')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServeDoorKnockingController {
  constructor(
    private readonly generationService: OutreachDoorKnockingGenerationService,
    private readonly profileContext: OutreachServeComposeContextService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServeDoorKnockingController.name)
  }

  // Office name and place are prompt enrichment only, same as the serve
  // phone-banking controller's buildServeContext — an election-api failure
  // must not fail the draft. The Public Profile lookup is a local DB read
  // (never campaign tables), so it runs outside the try/catch and propagates a
  // real failure rather than degrading silently.
  private async buildServeContext(
    electedOffice: ElectedOffice,
  ): Promise<{ office: string; context: string[] }> {
    let office = ''
    const context: string[] = []
    try {
      const [positionName, district] = await Promise.all([
        this.organizations.resolvePositionNameByOrganizationSlug(
          electedOffice.organizationSlug,
        ),
        this.organizations.getDistrictForOrgSlug(
          electedOffice.organizationSlug,
        ),
      ])
      office = positionName ?? ''
      const city =
        district &&
        OrganizationsService.extractCityFromDistrictName(district.l2Name)
      if (city && district) {
        context.push(
          `Where the elected official serves: ${city}, ${district.state}.`,
        )
      }
    } catch (err) {
      this.logger.warn(
        { err },
        'office/place resolution failed for serve door-knocking compose',
      )
    }
    context.push(
      ...(await this.profileContext.buildProfileContext(electedOffice.userId)),
    )
    return { office, context }
  }

  @Post('door-knocking/draft')
  @ResponseSchema(DoorKnockingTalkingPointsDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(
      new ZodValidationPipe(ServeDoorKnockingTalkingPointsDraftRequestSchema),
    )
    input: ServeDoorKnockingTalkingPointsDraftRequest,
  ): Promise<DoorKnockingTalkingPointsDraftResponse> {
    const { office, context } = await this.buildServeContext(electedOffice)

    return this.generationService.generateDraft({
      input,
      name: electedOfficialName(user),
      office,
      userId: String(user.id),
      extraContext: context,
      // `isServe: true` is what keeps the Win-only dimensions out of the
      // description even if a saved filter somehow carries one — the catalog
      // already encodes which dimensions each rail may express.
      audienceDescription: describeFilterForTalkingPoints(input.filters, {
        isServe: true,
      }),
      voice: SERVE_DOOR_KNOCKING_VOICE,
    })
  }
}
