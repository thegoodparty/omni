import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common'
import {
  AudioUploadUrlRequestSchema,
  AudioUploadUrlResponseSchema,
  CONSTITUENT_FEEDBACK_AUDIO_MAX_BYTES,
  ConfirmConstituentFeedbackSchema,
  ConstituentFeedbackListResponseSchema,
  ConstituentFeedbackSchema,
  FeedbackReportResponseSchema,
  FeedbackThemeDetailSchema,
  IssueTagListResponseSchema,
  IssueTagSchema,
  PendingFeedbackResponseSchema,
  RecordConstituentFeedbackResponseSchema,
  RecordConstituentFeedbackSchema,
  SeedFeedbackRequestSchema,
  SeedFeedbackResponseSchema,
  SynthesisRunSchema,
  UpdateIssueTagSchema,
  type AudioUploadUrlRequest,
  type ConfirmConstituentFeedback,
  type RecordConstituentFeedback,
  type SeedFeedbackRequest,
  type UpdateIssueTag,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { FeaturesService } from '@/features/services/features.service'
import { ReqFile } from '@/files/decorators/ReqFiles.decorator'
import { FileUpload } from '@/files/files.types'
import { FilesInterceptor } from '@/files/interceptors/files.interceptor'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { ReqOrganizationRole } from '@/organizations/decorators/ReqOrganizationRole.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Organization, OrganizationRole, User } from '@/generated/prisma'
import { ConstituentFeedbackService } from './services/constituentFeedback.service'
import { FeedbackReportService } from './services/feedbackReport.service'
import { FeedbackSeedService } from './services/feedbackSeed.service'
import { FeedbackSynthesisService } from './services/feedbackSynthesis.service'
import { IssueTagService } from './services/issueTag.service'
import {
  ListConstituentFeedbackQuerySchema,
  type ListConstituentFeedbackQuery,
} from './schemas/listConstituentFeedback.schema'
import {
  ListIssueTagsQuerySchema,
  type ListIssueTagsQuery,
} from './schemas/listIssueTags.schema'
import {
  ListPendingFeedbackQuerySchema,
  type ListPendingFeedbackQuery,
} from './schemas/listPendingFeedback.schema'
import { ISSUE_CAPTURE_FLAG } from './util/issueCaptureFlag.util'

// Every route is gated, unlike the Serve SMS controller which gates only its
// writes. There is no inert read here: the reads ARE the feature, and a
// surface the user has not been rolled out to should not answer questions
// about it.
//
// This gates ROLLOUT, not authorization. @UseOrganization() and its role
// guard are the real access check and stay that way whatever the flag says.

// The two writes carry @AllowVolunteer(), the posture of the knock and call
// routes they follow: the person who had the conversation is who records and
// confirms it, and on Win that is usually a volunteer. Like those routes, a
// volunteer reaches only an effort they are assigned to (the service checks).
// So do the offline path's routes (the upload URL, the mock sink, the review
// list and its retry), where a volunteer also sees and retries only the
// memos they recorded.
// The read stays at the default, owner or campaign manager, because it is the
// CRM's record of a person. So do the report, synthesis and tag routes: what
// people said across an effort, and the org's vocabulary for it, are the
// manager's to read and curate.
@Controller('constituent-feedback')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class ConstituentFeedbackController {
  constructor(
    private readonly feedback: ConstituentFeedbackService,
    private readonly synthesis: FeedbackSynthesisService,
    private readonly reports: FeedbackReportService,
    private readonly tags: IssueTagService,
    private readonly seeds: FeedbackSeedService,
    private readonly features: FeaturesService,
  ) {}

  @Post()
  @AllowVolunteer()
  @ResponseSchema(RecordConstituentFeedbackResponseSchema)
  async capture(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Body(new ZodValidationPipe(RecordConstituentFeedbackSchema))
    body: RecordConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.capture({
      organizationSlug: organization.slug,
      actorUserId: user.id,
      role,
      body,
    })
  }

  // Where the phone puts a memo it recorded with no signal, before it posts
  // the memo with the key.
  @Post('audio-upload-url')
  @AllowVolunteer()
  @ResponseSchema(AudioUploadUrlResponseSchema)
  async audioUploadUrl(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(AudioUploadUrlRequestSchema))
    body: AudioUploadUrlRequest,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.audioUploadUrl({
      organizationSlug: organization.slug,
      clientKey: body.clientKey,
      contentType: body.contentType,
    })
  }

  // Dev only, mock mode only: stands in for the bucket's presigned POST,
  // with the same size cap, and discards the bytes. 404s anywhere else. Keyed
  // by the memo's clientKey rather than the whole audio key, which runs past
  // Fastify's 100-character route parameter limit; the key is that clientKey
  // under this org anyway.
  @Post('audio-upload/:clientKey')
  @AllowVolunteer()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(
    FilesInterceptor('file', {
      numFiles: 1,
      sizeLimit: CONSTITUENT_FEEDBACK_AUDIO_MAX_BYTES,
    }),
  )
  async mockAudioUpload(
    @ReqUser() user: User,
    @Param('clientKey', ParseUUIDPipe) _clientKey: string,
    @ReqFile() file?: FileUpload,
  ): Promise<void> {
    await this.assertFeatureEnabled(user)

    this.feedback.acceptMockUpload()
    if (!file) throw new BadRequestException('No recording found')
  }

  // The "Notes to review" list: an effort's unconfirmed memos.
  @Get('pending')
  @AllowVolunteer()
  @ResponseSchema(PendingFeedbackResponseSchema)
  async pending(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Query(new ZodValidationPipe(ListPendingFeedbackQuerySchema))
    query: ListPendingFeedbackQuery,
  ) {
    await this.assertFeatureEnabled(user)

    return {
      feedback: await this.feedback.listPending({
        organizationSlug: organization.slug,
        outreachId: query.outreachId,
        actorUserId: user.id,
        role,
      }),
    }
  }

  // Transcribe or extract a pending memo again.
  @Post(':id/retry')
  @AllowVolunteer()
  @ResponseSchema(ConstituentFeedbackSchema)
  async retry(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Param('id') id: string,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.retry({
      organizationSlug: organization.slug,
      id,
      actorUserId: user.id,
      role,
    })
  }

  @Patch(':id/confirm')
  @AllowVolunteer()
  @ResponseSchema(ConstituentFeedbackSchema)
  async confirm(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @ReqOrganizationRole() role: OrganizationRole,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmConstituentFeedbackSchema))
    body: ConfirmConstituentFeedback,
  ) {
    await this.assertFeatureEnabled(user)

    return this.feedback.confirm({
      organizationSlug: organization.slug,
      id,
      actorUserId: user.id,
      role,
      body,
    })
  }

  @Get()
  @ResponseSchema(ConstituentFeedbackListResponseSchema)
  async list(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Query(new ZodValidationPipe(ListConstituentFeedbackQuerySchema))
    query: ListConstituentFeedbackQuery,
  ) {
    await this.assertFeatureEnabled(user)

    return {
      feedback: await this.feedback.listForPerson({
        organizationSlug: organization.slug,
        personId: query.personId,
      }),
    }
  }

  @Get('efforts/:outreachId/report')
  @ResponseSchema(FeedbackReportResponseSchema)
  async report(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('outreachId', ParseIntPipe) outreachId: number,
  ) {
    await this.assertFeatureEnabled(user)

    return this.reports.effortReport({
      organizationSlug: organization.slug,
      outreachId,
    })
  }

  @Post('efforts/:outreachId/synthesize')
  @ResponseSchema(SynthesisRunSchema)
  async synthesize(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('outreachId', ParseIntPipe) outreachId: number,
  ) {
    await this.assertFeatureEnabled(user)

    return this.synthesis.requestRun({
      organizationSlug: organization.slug,
      outreachId,
      requestedByUserId: user.id,
      trigger: 'button',
    })
  }

  @Get('themes/:id')
  @ResponseSchema(FeedbackThemeDetailSchema)
  async theme(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('id') id: string,
  ) {
    await this.assertFeatureEnabled(user)

    return this.reports.themeDetail({
      organizationSlug: organization.slug,
      themeId: id,
    })
  }

  @Get('tags')
  @ResponseSchema(IssueTagListResponseSchema)
  async listTags(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Query(new ZodValidationPipe(ListIssueTagsQuerySchema))
    query: ListIssueTagsQuery,
  ) {
    await this.assertFeatureEnabled(user)

    return {
      tags: await this.tags.listForOrg({
        organizationSlug: organization.slug,
        status: query.status,
      }),
    }
  }

  @Patch('tags/:id')
  @ResponseSchema(IssueTagSchema)
  async updateTag(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIssueTagSchema)) body: UpdateIssueTag,
  ) {
    await this.assertFeatureEnabled(user)

    return this.tags.update({
      organizationSlug: organization.slug,
      id,
      body,
    })
  }

  // Dev only: fake confirmed memos on an effort. 404s on prod.
  @Post('seed')
  @ResponseSchema(SeedFeedbackResponseSchema)
  async seed(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(SeedFeedbackRequestSchema))
    body: SeedFeedbackRequest,
  ) {
    await this.assertFeatureEnabled(user)

    return this.seeds.seed({
      organizationSlug: organization.slug,
      actorUserId: user.id,
      body,
    })
  }

  // 404 rather than 403 when the flag is off: a surface the user has not been
  // rolled out to should not advertise that it exists.
  private async assertFeatureEnabled(user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: ISSUE_CAPTURE_FLAG,
    })
    if (!enabled) throw new NotFoundException()
  }
}
