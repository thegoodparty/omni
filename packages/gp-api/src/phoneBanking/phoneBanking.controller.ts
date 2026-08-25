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
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Campaign, Organization, User } from '../generated/prisma'
import { PhoneBankingCallService } from './services/phoneBankingCall.service'
import { PhoneBankingListService } from './services/phoneBankingList.service'

// Every route is Pro-gated through ContactsService.assertProAccess in-method
// (400, not 403) — the same deliberate no-guard-decorator shape
// DoorKnockingController uses.
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
    return this.listService.create(organization, campaign, input)
  }

  @Get('lists/:id')
  @UseOrganization()
  @ResponseSchema(PhoneBankingListSchema)
  async get(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.listService.getForOrganization(id, organization)
  }

  @Post('lists/:id/calls')
  @UseOrganization()
  @ResponseSchema(RecordPhoneBankingCallResponseSchema)
  async recordCall(
    @Param('id', ParseIntPipe) id: number,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(RecordPhoneBankingCallSchema))
    input: RecordPhoneBankingCall,
  ) {
    await this.contacts.assertProAccess(organization)
    return this.callService.recordCall(id, organization.slug, input, user.id)
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
