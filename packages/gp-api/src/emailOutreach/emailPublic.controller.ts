import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  EmailForwardConfirmState,
  EmailForwardConfirmStateSchema,
  EmailTokenRequest,
  EmailTokenRequestSchema,
  EmailUnsubscribeState,
  EmailUnsubscribeStateSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { EmailSnsWebhookService } from './services/emailSnsWebhook.service'
import { OutreachEmailSenderService } from './services/outreachEmailSender.service'
import { OutreachEmailUnsubscribeService } from './services/outreachEmailUnsubscribe.service'

// Everything here is reached from a link or a webhook, with no login. A GET
// never changes anything: the pages load state with it and act with a POST,
// so a mail scanner that opens a link can't unsubscribe anyone.
@Controller('email')
@PublicAccess()
export class EmailPublicController {
  constructor(
    private readonly unsubscribes: OutreachEmailUnsubscribeService,
    private readonly senders: OutreachEmailSenderService,
    private readonly snsWebhook: EmailSnsWebhookService,
  ) {}

  // The token rides in the query: it is longer than Fastify's 100-character
  // path parameter limit.
  @Get('unsubscribe')
  @ResponseSchema(EmailUnsubscribeStateSchema)
  getUnsubscribe(@Query('t') token = ''): Promise<EmailUnsubscribeState> {
    return this.unsubscribes.describe(token)
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(EmailUnsubscribeStateSchema)
  unsubscribe(
    @Body(new ZodValidationPipe(EmailTokenRequestSchema))
    input: EmailTokenRequest,
  ): Promise<EmailUnsubscribeState> {
    return this.unsubscribes.unsubscribeByToken(input.token, 'link')
  }

  @Post('unsubscribe/undo')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(EmailUnsubscribeStateSchema)
  undoUnsubscribe(
    @Body(new ZodValidationPipe(EmailTokenRequestSchema))
    input: EmailTokenRequest,
  ): Promise<EmailUnsubscribeState> {
    return this.unsubscribes.undoByToken(input.token)
  }

  // RFC 8058: a mail client POSTs here, with a form-encoded or multipart
  // body we don't need to read. It answers 200 and never redirects.
  @Post('unsubscribe/one-click')
  @HttpCode(HttpStatus.OK)
  async oneClickUnsubscribe(@Query('t') token?: string): Promise<{ ok: true }> {
    if (!token) {
      throw new BadRequestException('This link is not valid')
    }
    await this.unsubscribes.unsubscribeByToken(token, 'one_click')
    return { ok: true }
  }

  @Get('forward-confirm/:token')
  @ResponseSchema(EmailForwardConfirmStateSchema)
  getForwardConfirm(
    @Param('token') token: string,
  ): Promise<EmailForwardConfirmState> {
    return this.senders.describeForwardChange(token)
  }

  @Post('forward-confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(EmailForwardConfirmStateSchema)
  confirmForward(
    @Body(new ZodValidationPipe(EmailTokenRequestSchema))
    input: EmailTokenRequest,
  ): Promise<EmailForwardConfirmState> {
    return this.senders.confirmForward(input.token)
  }

  @Post('webhooks/sns')
  @HttpCode(HttpStatus.OK)
  async snsWebhookNotification(@Body() body: unknown): Promise<{ ok: true }> {
    await this.snsWebhook.handle(body)
    return { ok: true }
  }
}
