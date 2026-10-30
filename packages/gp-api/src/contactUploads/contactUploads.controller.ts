import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  AcceptSuggestedMatchesResponseSchema,
  ContactUploadSchema,
  ListContactUploadRowsQuerySchema,
  ListContactUploadRowsResponseSchema,
  ListContactUploadsResponseSchema,
  PresignContactUploadFileResponseSchema,
  PresignContactUploadFileSchema,
  SERVE_IMPORT_CONTACTS_FLAG,
  SetContactUploadRowMatchSchema,
  type PresignContactUploadFile,
  type SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { Organization, User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  ContactUploadParamsDTO,
  ContactUploadRowParamsDTO,
} from './schemas/contactUploadParams.schema'
import { ContactUploadsService } from './services/contactUploads.service'

@Controller('contact-uploads')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ContactUploadsController {
  constructor(
    private readonly uploads: ContactUploadsService,
    private readonly features: FeaturesService,
    private readonly contacts: ContactsService,
  ) {}

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(PresignContactUploadFileResponseSchema)
  async presignFile(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(PresignContactUploadFileSchema))
    body: PresignContactUploadFile,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.presignFile({
      organization,
      userId: user.id,
      byteSize: body.byteSize,
      fileName: body.fileName,
      name: body.name,
      columnMapping: body.columnMapping,
    })
  }

  @Post(':id/uploaded')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(ContactUploadSchema)
  async confirmUploaded(
    @ReqOrganization() organization: Organization,
    @Param() { id }: ContactUploadParamsDTO,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.confirmUploaded(organization, id)
  }

  @Get()
  @ResponseSchema(ListContactUploadsResponseSchema)
  async listUploads(@ReqOrganization() organization: Organization) {
    await this.assertImportContactsOn(organization)
    return this.uploads.listUploads(organization)
  }

  @Get(':id')
  @ResponseSchema(ContactUploadSchema)
  async getUpload(
    @ReqOrganization() organization: Organization,
    @Param() { id }: ContactUploadParamsDTO,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.getUpload(organization, id)
  }

  @Get(':id/rows')
  @ResponseSchema(ListContactUploadRowsResponseSchema)
  async listRows(
    @ReqOrganization() organization: Organization,
    @Param() { id }: ContactUploadParamsDTO,
    @Query(new ZodValidationPipe(ListContactUploadRowsQuerySchema))
    query: z.output<typeof ListContactUploadRowsQuerySchema>,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.listRows(organization, id, query)
  }

  @Put(':id/rows/:rowId/match')
  @ResponseSchema(ContactUploadSchema)
  async setRowMatch(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Param() { id, rowId }: ContactUploadRowParamsDTO,
    @Body(new ZodValidationPipe(SetContactUploadRowMatchSchema))
    body: SetContactUploadRowMatch,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.setRowMatch({
      organization,
      uploadId: id,
      rowId,
      userId: user.id,
      body,
    })
  }

  @Post(':id/accept-suggested')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(AcceptSuggestedMatchesResponseSchema)
  async acceptSuggested(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Param() { id }: ContactUploadParamsDTO,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.acceptSuggested({
      organization,
      uploadId: id,
      userId: user.id,
    })
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(ContactUploadSchema)
  async retryUpload(
    @ReqOrganization() organization: Organization,
    @Param() { id }: ContactUploadParamsDTO,
  ) {
    await this.assertImportContactsOn(organization)
    return this.uploads.retryUpload(organization, id)
  }

  // Rolled out per org: the flag follows the org's owner. A Win campaign
  // also needs Pro, the same gate as opening a contact's details.
  private async assertImportContactsOn(
    organization: Organization,
  ): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user: organization.ownerId,
      feature: SERVE_IMPORT_CONTACTS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    await this.contacts.assertProAccess(organization)
  }
}
