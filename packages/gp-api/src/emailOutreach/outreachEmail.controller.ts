import {
  Body,
  Controller,
  Get,
  BadRequestException,
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
  EmailRecipientUploadRequestSchema,
  EmailRecipientUploadResponse,
  EmailRecipientUploadResponseSchema,
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
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { User } from '../generated/prisma'
import { EMAIL_UPLOAD_MAX_BYTES } from './emailOutreach.const'
import { OutreachEmailConfirmService } from './services/outreachEmailConfirm.service'
import { OutreachEmailGenerationService } from './services/outreachEmailGeneration.service'
import { OutreachEmailImageService } from './services/outreachEmailImage.service'
import { OutreachEmailTestService } from './services/outreachEmailTest.service'
import { OutreachEmailService } from './services/outreachEmail.service'
import { OutreachEmailRecipientService } from './services/outreachEmailRecipient.service'
import { OutreachEmailScopeService } from './services/outreachEmailScope.service'
import { OutreachEmailSenderService } from './services/outreachEmailSender.service'

@Controller('outreach/email')
@UseCampaign({ include: { user: true } })
@UseInterceptors(ZodResponseInterceptor)
export class OutreachEmailController {
  constructor(
    private readonly scopes: OutreachEmailScopeService,
    private readonly senders: OutreachEmailSenderService,
    private readonly emails: OutreachEmailService,
    private readonly recipients: OutreachEmailRecipientService,
    private readonly generation: OutreachEmailGenerationService,
    private readonly images: OutreachEmailImageService,
    private readonly tests: OutreachEmailTestService,
    private readonly confirms: OutreachEmailConfirmService,
  ) {}

  @Get('sender')
  @ResponseSchema(EmailSenderSchema)
  async getSender(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<EmailSender> {
    const scope = await this.scopes.forCampaign(campaign, user)
    return this.senders.toView(await this.senders.findOrCreate(scope))
  }

  @Patch('sender')
  @ResponseSchema(EmailSenderSchema)
  async updateSender(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(EmailSenderUpdateSchema))
    input: EmailSenderUpdate,
  ): Promise<EmailSender> {
    const scope = await this.scopes.forCampaign(campaign, user)
    return this.senders.toView(
      await this.senders.startForwardChange(scope, input.forwardToEmail),
    )
  }

  @Post('draft')
  @ResponseSchema(EmailAiDraftResponseSchema)
  async aiDraft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(EmailAiDraftRequestSchema))
    input: EmailAiDraftRequest,
  ): Promise<EmailAiDraftResponse> {
    return this.generation.draftForCampaign(campaign, user, input)
  }

  @Post('images/presign')
  @ResponseSchema(EmailImagePresignResponseSchema)
  async presignImage(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(EmailImagePresignRequestSchema))
    input: EmailImagePresignRequest,
  ): Promise<EmailImagePresignResponse> {
    return this.images.createUploadUrl(
      await this.scopes.forCampaign(campaign, user),
      input,
    )
  }

  @Post(':id/test')
  @ResponseSchema(EmailTestSendResponseSchema)
  async sendTest(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailTestSendResponse> {
    return this.tests.sendTest(
      await this.scopes.forCampaign(campaign, user),
      id,
      user,
    )
  }

  @Post(':id/confirm')
  @ResponseSchema(EmailConfirmResponseSchema)
  async confirm(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EmailConfirmRequestSchema))
    input: EmailConfirmRequest,
  ): Promise<EmailConfirmResponse> {
    return this.confirms.confirm({
      scope: await this.scopes.forCampaign(campaign, user),
      outreachId: id,
      user,
      mode: 'win',
      isPro: campaign.isPro === true,
      paymentMethodId: input.paymentMethodId,
    })
  }

  @Post(':id/cancel')
  @ResponseSchema(EmailSendSchema)
  async cancel(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailSend> {
    return this.confirms.cancel(
      await this.scopes.forCampaign(campaign, user),
      id,
    )
  }

  @Post()
  @ResponseSchema(EmailDraftSchema)
  async saveDraft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(EmailDraftSaveSchema)) input: EmailDraftSave,
  ): Promise<EmailDraft> {
    return this.emails.saveDraft(
      await this.scopes.forCampaign(campaign, user),
      input,
    )
  }

  @Get(':id')
  @ResponseSchema(EmailSendSchema)
  async getDraft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EmailSend> {
    return this.emails.get(await this.scopes.forCampaign(campaign, user), id)
  }

  @Post(':id/recipients')
  @UseInterceptors(
    FilesInterceptor('file', {
      mode: 'buffer',
      sizeLimit: EMAIL_UPLOAD_MAX_BYTES,
    }),
  )
  @ResponseSchema(EmailRecipientUploadResponseSchema)
  async uploadRecipients(
    @ReqUser() user: User,
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EmailRecipientUploadRequestSchema))
    _body: object,
    @ReqFile() file?: FileUpload,
  ): Promise<EmailRecipientUploadResponse> {
    if (!file) {
      throw new BadRequestException('No file found')
    }
    return this.recipients.replaceFromCsv(
      await this.scopes.forCampaign(campaign, user),
      id,
      file.data,
      user.id,
    )
  }
}
