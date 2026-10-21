import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Organization, User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { isImportContactsPocEnabled } from '@/peopleDb/databricks/universalContactsView.poc'
import {
  AmbiguousRowsQueryDTO,
  ContactImportParamsDTO,
  ContactImportRowParamsDTO,
  CreateContactImportDTO,
  ResolveImportRowDTO,
} from './pocImportContacts.schema'
import { PocContactImportService } from './services/pocContactImport.service'

const assertEnabled = () => {
  if (!isImportContactsPocEnabled()) throw new NotFoundException()
}

@Controller('poc/contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
export class PocImportContactsController {
  constructor(private readonly imports: PocContactImportService) {}

  @Post('imports')
  createImport(
    @Body() { fileName, rows }: CreateContactImportDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    assertEnabled()
    return this.imports.createImport(organization, user.id, fileName, rows)
  }

  @Get('imports/:importId/ambiguous')
  listAmbiguousRows(
    @Param() { importId }: ContactImportParamsDTO,
    @Query() { page, pageSize }: AmbiguousRowsQueryDTO,
    @ReqOrganization() organization: Organization,
  ) {
    assertEnabled()
    return this.imports.listAmbiguousRows(
      organization,
      importId,
      page,
      pageSize,
    )
  }

  @Put('imports/:importId/rows/:rowIndex/resolution')
  resolveRow(
    @Param() { importId, rowIndex }: ContactImportRowParamsDTO,
    @Body() { resolution, personId }: ResolveImportRowDTO,
    @ReqOrganization() organization: Organization,
  ) {
    assertEnabled()
    return this.imports.resolveRow(
      organization,
      importId,
      rowIndex,
      resolution === 'link' && personId ? personId : null,
    )
  }

  @Post('imports/:importId/commit')
  commitImport(
    @Param() { importId }: ContactImportParamsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    assertEnabled()
    return this.imports.commitImport(organization, importId, user.id)
  }

  @Get('counts')
  universalCounts(@ReqOrganization() organization: Organization) {
    assertEnabled()
    return this.imports.universalCounts(organization)
  }
}
