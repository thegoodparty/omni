import { Body, Controller, Param, Patch, Post, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Organization, User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import {
  PocImportDTO,
  PocImportParamsDTO,
  PocPersonParamsDTO,
  PocSetFieldDTO,
} from './pocOrgLayer.schema'
import { PocOrgLayerService } from './services/pocOrgLayer.service'

@Controller('poc/contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
export class PocOrgLayerController {
  constructor(private readonly pocOrgLayer: PocOrgLayerService) {}

  @Post('import')
  importContacts(
    @Body() { rows }: PocImportDTO,
    @ReqOrganization() organization: Organization,
  ) {
    return this.pocOrgLayer.importRows(organization, rows)
  }

  @Post('import/:importId/commit')
  commitImport(
    @Param() { importId }: PocImportParamsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.pocOrgLayer.commitImport(organization, importId, user.id)
  }

  @Patch(':personId/field')
  setField(
    @Param() { personId }: PocPersonParamsDTO,
    @Body() { field, value }: PocSetFieldDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.pocOrgLayer.setField(
      organization,
      personId,
      field,
      value,
      user.id,
    )
  }

  @Post(':personId/remove')
  remove(
    @Param() { personId }: PocPersonParamsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.pocOrgLayer.appendEvent(
      organization,
      personId,
      'remove',
      user.id,
    )
  }

  @Post(':personId/restore')
  restore(
    @Param() { personId }: PocPersonParamsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    return this.pocOrgLayer.appendEvent(
      organization,
      personId,
      'restore',
      user.id,
    )
  }
}
