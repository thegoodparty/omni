import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  EmailAiDraftRequest,
  EmailConfirmRequest,
  EmailConfirmRequestSchema,
  EmailConfirmResponse,
  EmailConfirmResponseSchema,
  EmailAiDraftRequestSchema,
  EmailAiDraftResponse,
  EmailAiDraftResponseSchema,
  EmailDraft,
  EmailDraftSave,
  EmailDraftSaveSchema,
  EmailDraftSchema,
  EmailSend,
  EmailSendSchema,
  EmailImagePresignRequest,
  EmailImagePresignRequestSchema,
  EmailImagePresignResponse,
  EmailImagePresignResponseSchema,
  EmailSender,
  EmailSenderSchema,
  EmailSenderUpdate,
  EmailSenderUpdateSchema,
  EmailTestSendResponse,
  EmailTestSendResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, User } from '../generated/prisma'
import { OutreachEmailConfirmService } from './services/outreachEmailConfirm.service'
import { OutreachEmailGenerationService } from './services/outreachEmailGeneration.service'
import { OutreachEmailImageService } from './services/outreachEmailImage.service'
import { OutreachEmailTestService } from './services/outreachEmailTest.service'
import { OutreachEmailService } from './services/outreachEmail.service'
import { OutreachEmailScopeService } from './services/outreachEmailScope.service'
import { OutreachEmailSenderService } from './services/outreachEmailSender.service'

@Controller('outreach/serve/email')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachServeEmailController {
  constructor(
    private readonly scopes: OutreachEmailScopeService,
    private readonly senders: OutreachEmailSenderService,
    private readonly emails: OutreachEmailService,
    private readonly generation: OutreachEmailGenerationService,
    private readonly images: OutreachEmailImageService,
    private readonly tests: OutreachEmailTestService,
    private readonly confirms: OutreachEmailConfirmService,
  ) {}

  @Get('sender')
  @ResponseSchema(EmailSenderSchema)
  async getSender(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): Promise<EmailSender> {
    const scope = await this.scopes.forOffice(electedOffice, user)
    return this.senders.toView(await this.senders.findOrCreate(scope))
  }

  @Patch('sender')
  @ResponseSchema(EmailSenderSchema)
  async updateSender(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(EmailSenderUpdateSchema))
    input: EmailSenderUpdate,
  ): Promise<EmailSender> {
    const scope = await this.scopes.forOffice(electedOffice, user)
    return this.senders.toView(
      await this.senders.startForwardChange(scope, input.forwardToEmail),
    )
  }

  @Post('draft')
  @ResponseSchema(EmailAiDraftResponseSchema)
  async aiDraft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(EmailAiDraftRequestSchema))
    input: EmailAiDraftRequest,
  ): Promise<EmailAiDraftResponse> {
    return this.generation.draftForOffice(electedOffice, user, input)
  }

  @Post('images/presign')
  @ResponseSchema(EmailImagePresignResponseSchema)
  async presignImage(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(EmailImagePresignRequestSchema))
    input: EmailImagePresignRequest,
  ): Promise<EmailImagePresignResponse> {
    return this.images.createUploadUrl(
      await this.scopes.forOffice(electedOffice, user),
      input,
    )
  }

  @Post(':id/test')
  @ResponseSchema(EmailTestSendResponseSchema)
  async sendTest(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailTestSendResponse> {
    return this.tests.sendTest(
      await this.scopes.forOffice(electedOffice, user),
      id,
      user,
    )
  }

  @Post(':id/confirm')
  @ResponseSchema(EmailConfirmResponseSchema)
  async confirm(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EmailConfirmRequestSchema))
    input: EmailConfirmRequest,
  ): Promise<EmailConfirmResponse> {
    return this.confirms.confirm({
      scope: await this.scopes.forOffice(electedOffice, user),
      outreachId: id,
      user,
      mode: 'serve',
      isPro: false,
      paymentMethodId: input.paymentMethodId,
    })
  }

  @Post(':id/cancel')
  @ResponseSchema(EmailSendSchema)
  async cancel(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailSend> {
    return this.confirms.cancel(
      await this.scopes.forOffice(electedOffice, user),
      id,
    )
  }

  @Post()
  @ResponseSchema(EmailDraftSchema)
  async saveDraft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Body(new ZodValidationPipe(EmailDraftSaveSchema)) input: EmailDraftSave,
  ): Promise<EmailDraft> {
    return this.emails.saveDraft(
      await this.scopes.forOffice(electedOffice, user),
      input,
      user.id,
    )
  }

  @Get(':id')
  @ResponseSchema(EmailSendSchema)
  async getDraft(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailSend> {
    return this.emails.get(await this.scopes.forOffice(electedOffice, user), id)
  }
}
