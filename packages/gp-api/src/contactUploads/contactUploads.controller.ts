import {
  BadRequestException,
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
  CONTACT_UPLOAD_MAX_BYTES,
  ContactUploadSchema,
  CreateContactUploadFieldsSchema,
  ListContactUploadRowsQuerySchema,
  ListContactUploadRowsResponseSchema,
  ListContactUploadsResponseSchema,
  SERVE_IMPORT_CONTACTS_FLAG,
  SetContactUploadRowMatchSchema,
  type SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { z } from 'zod'
import { Organization, User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { FeaturesService } from '@/features/services/features.service'
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
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('file', {
      mode: 'buffer',
      sizeLimit: CONTACT_UPLOAD_MAX_BYTES,
    }),
  )
  @ResponseSchema(ContactUploadSchema)
  async createUpload(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(CreateContactUploadFieldsSchema))
    fields: z.output<typeof CreateContactUploadFieldsSchema>,
    @ReqFile() file?: FileUpload,
  ) {
    await this.assertImportContactsOn(organization)
    if (!file || !Buffer.isBuffer(file.data)) {
      throw new BadRequestException('No file found')
    }
    return this.uploads.createUpload({
      organization,
      userId: user.id,
      name: fields.name,
      columnMapping: fields.columnMapping,
      fileName: file.filename,
      file: file.data,
    })
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

  // Serve only, and rolled out per org: the flag follows the org's owner.
  private async assertImportContactsOn(
    organization: Organization,
  ): Promise<void> {
    const enabled =
      organization.slug.startsWith('eo-') &&
      (await this.features.isFeatureEnabled({
        user: organization.ownerId,
        feature: SERVE_IMPORT_CONTACTS_FLAG,
      }))
    if (!enabled) throw new NotFoundException()
  }
}
