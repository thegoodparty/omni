import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  ContactStatusesSchema,
  FollowUpStatusResponseSchema,
  UpdateFollowUpInputSchema,
  type UpdateFollowUpInput,
  CivicPanelStatusResponseSchema,
  CivicPanelSummarySchema,
  CivicPanelRepresentationSchema,
  CivicPanelBuildPlanResponseSchema,
  CreateCivicPanelBuildPlanInputSchema,
  UpdateCivicPanelBuildPlanInputSchema,
  MarkCivicPanelBuildStepInputSchema,
  type MarkCivicPanelBuildStepInput,
  type UpdateCivicPanelBuildPlanInput,
  type CreateCivicPanelBuildPlanInput,
  PrepareCivicPanelBuildStepResponseSchema,
  UpdateCivicPanelInputSchema,
  type UpdateCivicPanelInput,
  ListDetailContactsResponseSchema,
  PersonSchema,
  type UpdateContactStatusInput,
  UpdateContactStatusInputSchema,
  PeoplePrecinctsResponseSchema,
} from '@goodparty_org/contracts'
import { Organization, User } from '../generated/prisma'
import { FastifyReply } from 'fastify'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { FeaturesService } from '@/features/services/features.service'
import { SERVE_CITIZEN_PANELS_FLAG } from '@/shared/util/serveCitizenPanelsFlag.util'
import { CountContactsDTO } from './schemas/countContacts.schema'
import { GetPersonParamsDTO } from './schemas/getPerson.schema'
import { ListDetailContactsDTO } from './schemas/listDetailContacts.schema'
import { PolygonPreviewContactsDTO } from './schemas/polygonPreviewContacts.schema'
import { FilterPointsContactsDTO } from './schemas/filterPointsContacts.schema'
import {
  DownloadContactsDTO,
  ListContactsDTO,
} from './schemas/listContacts.schema'
import { UpdateContactStatusParamsDTO } from './schemas/updateContactStatus.schema'
import { ContactsService } from './services/contacts.service'
import { CivicPanelSummaryService } from './services/civicPanelSummary.service'
import { CivicPanelBuildPlanService } from './services/civicPanelBuildPlan.service'

@Controller('contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly civicPanelSummary: CivicPanelSummaryService,
    private readonly civicPanelBuildPlan: CivicPanelBuildPlanService,
    private readonly features: FeaturesService,
  ) {}

  @Get()
  async listContacts(
    @Query() filterDto: ListContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.findContacts(filterDto, organization)
  }

  @Get('download')
  async downloadContacts(
    @Query() dto: DownloadContactsDTO,
    @ReqOrganization() organization: Organization,
    @Res() res: FastifyReply,
  ) {
    // Headers (Content-Type, Content-Disposition, Set-Cookie) are written and
    // flushed inside the service AFTER pre-flight checks pass and the
    // upstream people-api stream is in hand. That keeps a structured 4xx/5xx
    // possible if the org isn't pro or the upstream call fails, instead of
    // committing `attachment; filename="contacts.csv"` to the wire and then
    // serving a JSON error body the browser would save to disk.
    await this.contactsService.downloadContacts(dto, res, organization)
  }

  @Get('stats')
  async getContactsStats(@ReqOrganization() organization: Organization) {
    return this.contactsService.getDistrictStats(organization)
  }

  // Before @Get(':id') — Nest matches in declaration order, so a literal
  // path declared after the param route would be swallowed by it.
  @Get('precincts')
  @ResponseSchema(PeoplePrecinctsResponseSchema)
  async getPrecincts(@ReqOrganization() organization: Organization) {
    return this.contactsService.getPrecincts(organization)
  }

  @Post('count')
  async countContacts(
    @Body() filters: CountContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.countContacts(filters, organization)
  }

  @Post('overlap-count')
  async overlapCount(
    @Body() filters: CountContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.overlapCount(filters, organization)
  }

  @Post('polygon-preview')
  async polygonPreview(
    @Body() dto: PolygonPreviewContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.polygonPreview(dto, organization)
  }

  // The dots the draw step draws on. Sibling of polygon-preview: same draft
  // payload, minus the shape — the map has to show the list before there is
  // a shape to narrow it with.
  @Post('points')
  async filterPoints(
    @Body() dto: FilterPointsContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.filterPoints(dto, organization)
  }

  @Get('list-detail')
  @ResponseSchema(ListDetailContactsResponseSchema)
  async getListDetail(
    @Query() dto: ListDetailContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.getListDetail(dto, organization)
  }

  // The same payload for an unsaved filter (a recommended list's detail
  // sheet) — a body rather than a segment id, like `count` above.
  @Post('list-detail')
  @ResponseSchema(ListDetailContactsResponseSchema)
  async getFilterDetail(
    @Body() filters: CountContactsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.getFilterDetail(filters, organization)
  }

  @Get('civic-panel')
  @ResponseSchema(CivicPanelSummarySchema)
  async getCivicPanelSummary(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelSummary.summaryFor(organization)
  }

  @Get('civic-panel/representation')
  @ResponseSchema(CivicPanelRepresentationSchema)
  async getCivicPanelRepresentation(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelSummary.representationFor(organization)
  }

  @Get('civic-panel/plan')
  @ResponseSchema(CivicPanelBuildPlanResponseSchema)
  async getCivicPanelBuildPlan(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.read(organization)
  }

  @Post('civic-panel/plan')
  @ResponseSchema(CivicPanelBuildPlanResponseSchema)
  async createCivicPanelBuildPlan(
    @Body(new ZodValidationPipe(CreateCivicPanelBuildPlanInputSchema))
    body: CreateCivicPanelBuildPlanInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.create(
      organization,
      body.hoursPerWeek,
      'panel_page',
    )
  }

  @Patch('civic-panel/plan')
  @ResponseSchema(CivicPanelBuildPlanResponseSchema)
  async updateCivicPanelBuildPlan(
    @Body(new ZodValidationPipe(UpdateCivicPanelBuildPlanInputSchema))
    body: UpdateCivicPanelBuildPlanInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.updateHours(
      organization,
      body.hoursPerWeek,
      'panel_page',
    )
  }

  @Post('civic-panel/plan/steps/:id/skip')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(CivicPanelBuildPlanResponseSchema)
  async skipCivicPanelBuildStep(
    @Param('id', ParseUUIDPipe) id: string,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.skip(organization, id)
  }

  @Post('civic-panel/plan/steps/:id/mark')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(CivicPanelBuildPlanResponseSchema)
  async markCivicPanelBuildStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MarkCivicPanelBuildStepInputSchema))
    body: MarkCivicPanelBuildStepInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.mark(organization, id, body.done)
  }

  @Post('civic-panel/plan/steps/:id/prepare')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(PrepareCivicPanelBuildStepResponseSchema)
  async prepareCivicPanelBuildStep(
    @Param('id', ParseUUIDPipe) id: string,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.civicPanelBuildPlan.prepare(organization, id)
  }

  @Get(':id')
  @ResponseSchema(PersonSchema)
  async getContact(
    @Param() params: GetPersonParamsDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.contactsService.findPerson(params.id, organization)
  }

  // Serve's own status write, separate from the PATCH below for the reasons
  // on FollowUpStatusSchema in contracts: no Pro gate (an ElectedOffice row is
  // the entitlement) and its own response, so Win's two-status guarantee is
  // untouched.
  @Patch(':personId/follow-up')
  @ResponseSchema(FollowUpStatusResponseSchema)
  async updateFollowUp(
    @Param() { personId }: UpdateContactStatusParamsDTO,
    @Body(new ZodValidationPipe(UpdateFollowUpInputSchema))
    body: UpdateFollowUpInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.contactsService.updateFollowUp(
      personId,
      body.value,
      organization,
      user.id,
    )
  }

  @Patch(':personId/civic-panel')
  @ResponseSchema(CivicPanelStatusResponseSchema)
  async updateCivicPanel(
    @Param() { personId }: UpdateContactStatusParamsDTO,
    @Body(new ZodValidationPipe(UpdateCivicPanelInputSchema))
    body: UpdateCivicPanelInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.assertCivicPanelsOn(user)
    return this.contactsService.updateCivicPanel(
      personId,
      body.value,
      organization,
      user.id,
    )
  }

  @Patch(':personId/status')
  @ResponseSchema(ContactStatusesSchema)
  async updateContactStatus(
    @Param() { personId }: UpdateContactStatusParamsDTO,
    @Body(new ZodValidationPipe(UpdateContactStatusInputSchema))
    body: UpdateContactStatusInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.contactsService.updateContactStatus(
      personId,
      body,
      organization,
      user.id,
    )
  }

  // 404 rather than 403 when the flag is off: a surface the user has not
  // been rolled out to should not advertise that it exists.
  private async assertCivicPanelsOn(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CITIZEN_PANELS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
  }
}
