import {
  Body,
  Controller,
  Param,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import {
  type LogContactInteractionInput,
  LogContactInteractionInputSchema,
  type LogContactInteractionResponse,
  LogContactInteractionResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from 'src/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from 'src/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from 'src/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactInteractionDoorKnock,
  ContactInteractionRobocall,
  ContactInteractionText,
  Organization,
  User,
} from '../generated/prisma'
import { LogContactInteractionParamsDTO } from './schemas/logInteraction.schema'
import { ContactsService } from './services/contacts.service'

const toDoorKnockApi = (
  row: ContactInteractionDoorKnock,
): LogContactInteractionResponse => ({
  channel: 'doorKnock',
  id: row.id,
  personId: row.personId,
  occurredAt: row.occurredAt,
  manual: row.manual,
  note: row.note,
  outcome: row.outcome,
  supportAnswer: row.supportAnswer,
})

// Text/robocall have no `outcome` column — the outcome is derived from
// whichever timestamp column the row actually has set, so the response
// always reflects the persisted row rather than echoing the request body.
const toTextApi = (
  row: ContactInteractionText,
): LogContactInteractionResponse => ({
  channel: 'text',
  id: row.id,
  personId: row.personId,
  occurredAt: row.occurredAt,
  manual: row.manual,
  note: row.note,
  outcome: row.respondedAt ? 'responded' : row.optedOutAt ? 'opted_out' : null,
})

const toRobocallApi = (
  row: ContactInteractionRobocall,
): LogContactInteractionResponse => ({
  channel: 'robocall',
  id: row.id,
  personId: row.personId,
  occurredAt: row.occurredAt,
  manual: row.manual,
  note: row.note,
  outcome: row.answeredAt
    ? 'answered'
    : row.voicemailLeftAt
      ? 'voicemail_left'
      : null,
})

@Controller('contacts')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class ContactInteractionsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly doorKnockService: ContactInteractionDoorKnockService,
    private readonly textService: ContactInteractionTextService,
    private readonly robocallService: ContactInteractionRobocallService,
  ) {}

  @Post(':personId/interactions')
  @ResponseSchema(LogContactInteractionResponseSchema)
  async logInteraction(
    @Param() { personId }: LogContactInteractionParamsDTO,
    @Body(new ZodValidationPipe(LogContactInteractionInputSchema))
    body: LogContactInteractionInput,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ): Promise<LogContactInteractionResponse> {
    await this.contactsService.assertContactsAccess(organization, user)
    await this.contactsService.assertProAccess(organization)
    // Every read path on this surface (findPerson/findContacts) resolves the
    // person through the org's district via people-api, so an out-of-district
    // or unknown personId 404s. The write path must match — otherwise a
    // caller could write an interaction row for a personId outside the org's
    // district scope, since nothing else here validates it.
    await this.contactsService.findPerson(personId, organization)

    const { slug: organizationSlug } = organization
    const occurredAt = body.occurredAt ?? new Date()

    if (body.channel === 'doorKnock') {
      const row = await this.doorKnockService.create({
        organizationSlug,
        personId,
        occurredAt,
        outcome: body.outcome,
        supportAnswer: body.supportAnswer ?? null,
        note: body.note ?? null,
        sourceId: null,
        manual: true,
      })
      return toDoorKnockApi(row)
    }

    if (body.channel === 'text') {
      const row = await this.textService.create({
        organizationSlug,
        personId,
        occurredAt,
        respondedAt: body.outcome === 'responded' ? occurredAt : null,
        optedOutAt: body.outcome === 'opted_out' ? occurredAt : null,
        note: body.note ?? null,
        outreachId: null,
        sourceEventId: null,
        manual: true,
      })
      return toTextApi(row)
    }

    const row = await this.robocallService.create({
      organizationSlug,
      personId,
      occurredAt,
      answeredAt: body.outcome === 'answered' ? occurredAt : null,
      voicemailLeftAt: body.outcome === 'voicemail_left' ? occurredAt : null,
      note: body.note ?? null,
      outreachId: null,
      sourceCallId: null,
      manual: true,
    })
    return toRobocallApi(row)
  }
}
