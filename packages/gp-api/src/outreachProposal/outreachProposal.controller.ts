import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Res,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { OutreachDetailSchema } from '@goodparty_org/contracts'
import { FastifyReply } from 'fastify'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { OutreachService } from '@/outreach/services/outreach.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Organization } from '../generated/prisma'

// Has a chat card's proposal been sent yet. The send itself happens in each
// channel's own create, which carries the card's key.
//
// Its own module rather than OutreachController to keep the CAS failure Slack
// that wraps every OutreachController route off a probe whose empty answer is
// normal. The read is org-scoped so a Win campaign's card resolves too.
@Controller('outreach/by-proposal-key')
@UseOrganization()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachProposalController {
  constructor(private readonly outreach: OutreachService) {}

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
}
