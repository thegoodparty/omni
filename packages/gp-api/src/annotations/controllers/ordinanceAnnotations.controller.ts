import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ElectedOffice, User } from '../../generated/prisma'
import {
  AnnotationResponseSchema,
  AnnotationsListResponseSchema,
  CreateAnnotationRequest,
  CreateAnnotationRequestSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { AnnotationsService } from '../services/annotations.service'

/**
 * Ordinance-scoped annotation routes.
 *
 * The draft slug resolves server-side to the Ordinance id, stored as the
 * annotation's `resourceId` — the frontend only ever sees the slug. Only
 * `bug_report` is supported here: this backs the draft's "Flag a bug"
 * affordance, not the full note/review system briefings carries.
 */
@Controller('ordinances/:slug/annotations')
export class OrdinanceAnnotationsController {
  constructor(private readonly annotations: AnnotationsService) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(AnnotationsListResponseSchema)
  async list(
    @Param('slug') slug: string,
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ) {
    const annotations = await this.annotations.listForOrdinance(
      slug,
      user.id,
      electedOffice,
    )
    return { annotations }
  }

  @UseElectedOffice()
  @Post()
  @ResponseSchema(AnnotationResponseSchema)
  async create(
    @Param('slug') slug: string,
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(CreateAnnotationRequestSchema))
    body: CreateAnnotationRequest,
  ) {
    return this.annotations.createForOrdinance(
      slug,
      user.id,
      electedOffice,
      body,
    )
  }
}
