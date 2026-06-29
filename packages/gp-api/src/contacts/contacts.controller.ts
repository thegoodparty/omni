import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
} from '@nestjs/common'
import { Organization, User } from '../generated/prisma'
import { FastifyReply } from 'fastify'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { CountContactsDTO } from './schemas/countContacts.schema'
import { GetPersonParamsDTO } from './schemas/getPerson.schema'
import {
  DownloadContactsDTO,
  ListContactsDTO,
} from './schemas/listContacts.schema'
import { ContactsService } from './services/contacts.service'

@Controller('contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  async listContacts(
    @Query() filterDto: ListContactsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.contactsService.assertContactsAccess(organization, user)
    return this.contactsService.findContacts(filterDto, organization)
  }

  @Get('download')
  async downloadContacts(
    @Query() dto: DownloadContactsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
    @Res() res: FastifyReply,
  ) {
    await this.contactsService.assertContactsAccess(organization, user)
    // Headers (Content-Type, Content-Disposition, Set-Cookie) are written and
    // flushed inside the service AFTER pre-flight checks pass and the
    // upstream people-api stream is in hand. That keeps a structured 4xx/5xx
    // possible if the org isn't pro or the upstream call fails, instead of
    // committing `attachment; filename="contacts.csv"` to the wire and then
    // serving a JSON error body the browser would save to disk.
    await this.contactsService.downloadContacts(dto, res, organization)
  }

  @Get('stats')
  async getContactsStats(
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.contactsService.assertContactsAccess(organization, user)
    return this.contactsService.getDistrictStats(organization)
  }

  @Post('count')
  async countContacts(
    @Body() filters: CountContactsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.contactsService.assertContactsAccess(organization, user)
    const count = await this.contactsService.countContacts(
      filters,
      organization,
    )
    return { count }
  }

  @Get(':id')
  async getContact(
    @Param() params: GetPersonParamsDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ) {
    await this.contactsService.assertContactsAccess(organization, user)
    return this.contactsService.findPerson(params.id, organization)
  }
}
