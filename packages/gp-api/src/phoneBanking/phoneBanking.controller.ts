import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  PhoneBankingCreate,
  PhoneBankingCreateResponseSchema,
  PhoneBankingCreateSchema,
  PhoneBankingListSchema,
  RecordPhoneBankingCall,
  RecordPhoneBankingCallResponseSchema,
  RecordPhoneBankingCallSchema,
  ServePhoneBankingCreate,
  ServePhoneBankingCreateSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganizationRole } from '@/organizations/decorators/ReqOrganizationRole.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  Campaign,
  ElectedOffice,
  Organization,
  OrganizationRole,
  User,
} from '../generated/prisma'
import { PhoneBankingCallService } from './services/phoneBankingCall.service'
import { PhoneBankingListService } from './services/phoneBankingList.service'

// Every route is Pro-gated through ContactsService.assertProAccess in-method
// (400, not 403) — the same deliberate no-guard-decorator shape
// DoorKnockingController uses. Role posture (ENG-11050): create, serve-create,
// and delete default to manager+ (OrganizationRoleGuard's unmarked posture);
// GET lists/:id and POST lists/:id/calls carry @AllowVolunteer() and gate a
// volunteer further via PhoneBankingAccessService (an OutreachAssignment on
// the list's envelope, else 404 — the data is the gate, no flag check here).
@Controller('phone-banking')
@UseInterceptors(ZodResponseInterceptor)
export class PhoneBankingController {
  constructor(
    private readonly listService: PhoneBankingListService,
    private readonly callService: PhoneBankingCallService,
    private readonly contacts: ContactsService,
  ) {}

  @Post('lists')
  @UseOrganization()
  @UseCampaign({ continueIfNotFound: true })
  @ResponseSchema(PhoneBankingCreateResponseSchema)
  async create(
    @ReqOrganization() organization: Organization,
    @ReqCampaign() campaign: Campaign | null,
    @Body(new ZodValidationPipe(PhoneBankingCreateSchema))
    input: PhoneBankingCreate,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.listService.create(
      organization,
      campaign && {
        campaignId: campaign.id,
        organizationSlug: campaign.organizationSlug,
      },
      input,
    )
  }

  // Serve counterpart: @UseElectedOffice() re-derives the surface from the
  // org's own ElectedOffice row (never trusting the client), same as
  // OutreachServeSocialController. The scope is always { campaignId: null,
  // organizationSlug } — never derived from whether this org also happens to
  // hold a Campaign (the Win/Serve isolation invariant, ENG-10976).
  @Post('serve/lists')
  @UseElectedOffice()
  @UseOrganization()
  @ResponseSchema(PhoneBankingCreateResponseSchema)
  async createServe(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(ServePhoneBankingCreateSchema))
    input: ServePhoneBankingCreate,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.listService.create(
      organization,
      { campaignId: null, organizationSlug: electedOffice.organizationSlug },
      input,
    )
  }

  @Get('lists/:id')
  @UseOrganization()
  @AllowVolunteer()
  @ResponseSchema(PhoneBankingListSchema)
  async get(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @ReqUser() user: User,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.listService.getForOrganization(id, organization, role, user.id)
  }

  @Post('lists/:id/calls')
  @UseOrganization()
  @AllowVolunteer()
  @ResponseSchema(RecordPhoneBankingCallResponseSchema)
  async recordCall(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(RecordPhoneBankingCallSchema))
    input: RecordPhoneBankingCall,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.callService.recordCall(
      id,
      organization.slug,
      role,
      input,
      user.id,
    )
  }

  @Delete('lists/:id')
  @UseOrganization()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    await this.listService.delete(id, organization.slug)
  }
}
