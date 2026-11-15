import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  ContactSourcesResponseSchema,
  SERVE_IMPORT_CONTACTS_FLAG,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { Organization } from '@/generated/prisma'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactSourcesParamsDTO } from './schemas/contactUploadParams.schema'
import { ContactUploadMatchService } from './services/contactUploadMatch.service'

// Lives beside the uploads rather than in ContactsController because every
// answer comes from upload rows in Postgres.
@Controller('contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ContactSourcesController {
  constructor(
    private readonly matches: ContactUploadMatchService,
    private readonly features: FeaturesService,
    private readonly contacts: ContactsService,
  ) {}

  @Get(':personId/sources')
  @ResponseSchema(ContactSourcesResponseSchema)
  async getSources(
    @ReqOrganization() organization: Organization,
    @Param() { personId }: ContactSourcesParamsDTO,
  ) {
    const enabled = await this.features.isFeatureEnabled({
      user: organization.ownerId,
      feature: SERVE_IMPORT_CONTACTS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    await this.contacts.assertProAccess(organization)
    return this.matches.sourcesFor(organization, personId.toLowerCase())
  }
}
