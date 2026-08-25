import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  type ContactNote as ContactNoteDto,
  ContactNoteListResponseSchema,
  ContactNoteSchema,
  type ContactNoteListResponse,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import {
  ContactNoteService,
  ContactNoteWithActor,
} from '@/contactNote/services/contactNote.service'
import { Organization, User } from '../generated/prisma'
import {
  ContactNoteBodyDTO,
  ContactNoteIdParamsDTO,
  ContactNotePersonParamsDTO,
} from './schemas/contactNote.schema'
import { ContactsService } from './services/contacts.service'

const toApi = (note: ContactNoteWithActor): ContactNoteDto => ({
  id: note.id,
  personId: note.personId,
  body: note.body,
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
  actorName: note.actor
    ? [note.actor.firstName, note.actor.lastName].filter(Boolean).join(' ') ||
      null
    : null,
})

@Controller('contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ContactNotesController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactNoteService: ContactNoteService,
  ) {}

  @Get(':personId/notes')
  @ResponseSchema(ContactNoteListResponseSchema)
  async listNotes(
    @Param() { personId }: ContactNotePersonParamsDTO,
    @ReqOrganization() organization: Organization,
  ): Promise<ContactNoteListResponse> {
    await this.contactsService.assertProAccess(organization)
    const notes = await this.contactNoteService.listForPerson(
      organization.slug,
      personId,
    )
    return { results: notes.map(toApi) }
  }

  @Post(':personId/notes')
  @ResponseSchema(ContactNoteSchema)
  async createNote(
    @Param() { personId }: ContactNotePersonParamsDTO,
    @Body() body: ContactNoteBodyDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ): Promise<ContactNoteDto> {
    await this.contactsService.assertProAccess(organization)
    const note = await this.contactNoteService.create(
      organization.slug,
      personId,
      body.body,
      user.id,
    )
    return toApi(note)
  }

  @Patch('notes/:noteId')
  @ResponseSchema(ContactNoteSchema)
  async updateNote(
    @Param() { noteId }: ContactNoteIdParamsDTO,
    @Body() body: ContactNoteBodyDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ): Promise<ContactNoteDto> {
    await this.contactsService.assertProAccess(organization)
    const updated = await this.contactNoteService.updateByIdAndOrganizationSlug(
      noteId,
      organization.slug,
      body.body,
      user.id,
    )
    if (!updated) {
      throw new NotFoundException('Note not found')
    }
    return toApi(updated)
  }

  @Delete('notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNote(
    @Param() { noteId }: ContactNoteIdParamsDTO,
    @ReqOrganization() organization: Organization,
  ): Promise<void> {
    await this.contactsService.assertProAccess(organization)
    const deletedCount =
      await this.contactNoteService.deleteByIdAndOrganizationSlug(
        noteId,
        organization.slug,
      )
    if (deletedCount === 0) {
      throw new NotFoundException('Note not found')
    }
  }
}
