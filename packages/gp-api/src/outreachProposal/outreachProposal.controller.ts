import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { OutreachDetailSchema } from '@goodparty_org/contracts'
import { FastifyReply } from 'fastify'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { OutreachService } from '@/outreach/services/outreach.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, Organization } from '../generated/prisma'
import { SendOutreachProposalSchema } from './schemas/sendOutreachProposal.schema'
import { OutreachProposalService } from './services/outreachProposal.service'

// Both halves of a chat card's lifecycle: does this proposal already have an
// outreach, and make one if it does not.
//
// Its own module rather than OutreachController because the send runs through
// PhoneBankingListService, and PhoneBankingModule already imports
// OutreachModule — reaching the other way from inside OutreachModule would
// build the cycle that module's own comment says does not exist. It also
// keeps the CAS failure Slack that wraps every OutreachController route off
// a probe whose empty answer is normal.
//
// The read is org-scoped so a Win campaign's card resolves too. The send is
// Serve phone banking, so @UseElectedOffice on it is the server-side mirror
// of the webapp's serveAccess(): the client's chosen surface is never
// trusted, so ownership comes from the org's own ElectedOffice row, exactly
// as POST /v1/phone-banking/serve/lists derives it.
@Controller('outreach/by-proposal-key')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachProposalController {
  constructor(
    private readonly proposals: OutreachProposalService,
    private readonly outreach: OutreachService,
    private readonly contacts: ContactsService,
  ) {}

  // Nothing under this key means the proposal has not been sent yet, which is
  // the normal answer rather than a failure — so the 404 is written onto the
  // response instead of thrown, and never reaches the global error log.
  @Get(':proposalKey')
  @ResponseSchema(OutreachDetailSchema.nullable())
  async find(
    @ReqOrganization() organization: Organization,
    @Param('proposalKey', ParseUUIDPipe) proposalKey: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const outreach = await this.outreach.findByProposalKey(
      proposalKey,
      organization.slug,
    )
    if (!outreach) {
      res.status(HttpStatus.NOT_FOUND)
      return null
    }
    return outreach
  }

  // PUT, and 200 on the first call as well as every repeat: the key is minted
  // from the chat tool call rather than sent by the client, so a double
  // click, a reload and a retry all land here with the same one and must all
  // resolve to the same outreach.
  @Put(':proposalKey')
  @UseElectedOffice()
  @ResponseSchema(OutreachDetailSchema)
  async send(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @ReqOrganization() organization: Organization,
    @Param('proposalKey', ParseUUIDPipe) proposalKey: string,
    @Body() input: SendOutreachProposalSchema,
  ) {
    // The gate the Serve phone-banking create carries. A caller who could not
    // build this list from the flow must not be able to build it from a card.
    await this.contacts.assertProAccess(organization)
    return this.proposals.send(organization, electedOffice, proposalKey, input)
  }
}
