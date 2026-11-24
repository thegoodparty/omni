import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE, vendorBaseUrl } from '@/shared/util/appEnvironment.util'
import { VendorMockVendor } from '@/generated/prisma'
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { FastifyInstance } from 'fastify'
import { MimeTypes } from 'http-constants-ts'
import { randomUUID } from 'crypto'
import { formatISO } from 'date-fns'
import { z } from 'zod'
import { VendorMockRecordService } from '../vendorMockRecord.service'
import {
  S2W_API_BASE_URL,
  S2W_MOCK_API_KEY_ID,
  S2W_MOCK_API_KEY_SECRET,
} from '@/vendors/scaleToWin/config/scaleToWinBaseConfig'
import {
  CopyCampaignBodySchema,
  PreviewMessagesBodySchema,
  ScaleToWinCampaign,
} from '@/vendors/scaleToWin/schemas/scaleToWinCampaign.schema'
import {
  CsvUploadBodySchema,
  PresignedPutBodySchema,
} from '@/vendors/scaleToWin/schemas/scaleToWinContacts.schema'
import {
  SCALE_TO_WIN_MOCK_KIND,
  ScaleToWinMockCampaignState,
  ScaleToWinMockCampaignStateSchema,
  ScaleToWinMockUploadStateSchema,
} from '@/vendors/scaleToWin/schemas/scaleToWinMock.schema'

const MOCK_AUTH = `Basic ${Buffer.from(
  `${S2W_MOCK_API_KEY_ID}:${S2W_MOCK_API_KEY_SECRET}`,
).toString('base64')}`

// Fastify's 1 MiB default would refuse a real wave's CSV. 500k rows of a
// few short columns fit well under this.
const MAX_CSV_BYTES = 64 * 1024 * 1024

const CAMPAIGN_PATH = 'subaccounts/:subaccountId/campaigns/:id'

// Scale to Win's error body is `{ message, code, issues? }`, so the mock's
// errors use it too and exercise the client's error mapping.
const vendorError = (
  status: HttpStatus,
  message: string,
  code: string,
  issues?: z.core.$ZodIssue[],
) => new HttpException({ message, code, issues }, status)

const parseBody = <T extends z.ZodType>(schema: T, body: object) => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw vendorError(
      HttpStatus.BAD_REQUEST,
      'Invalid request body',
      'VALIDATION_ERROR',
      parsed.error.issues,
    )
  }
  return parsed.data
}

const countCsvRows = (csv: string) =>
  Math.max(csv.split('\n').filter((line) => line.trim() !== '').length - 1, 0)

@Controller('vendor-mocks/scaleToWin')
@PublicAccess()
export class ScaleToWinMockController {
  constructor(
    private readonly vendorMockRecord: VendorMockRecordService,
    httpAdapterHost: HttpAdapterHost,
  ) {
    // Only the mock upload route takes a CSV body, so the parser stays off a
    // live API where no route expects one.
    const fastify = httpAdapterHost.httpAdapter.getInstance<FastifyInstance>()
    if (
      VENDOR_MODE === 'mock' &&
      !fastify.hasContentTypeParser(MimeTypes.IMAGE_CSV)
    ) {
      fastify.addContentTypeParser(
        MimeTypes.IMAGE_CSV,
        { parseAs: 'string', bodyLimit: MAX_CSV_BYTES },
        (_req, body, done) => done(null, body.toString()),
      )
    }
  }

  @Post(`${CAMPAIGN_PATH}/copy`)
  @HttpCode(HttpStatus.OK)
  async copyCampaign(
    @Headers('authorization') auth: string | undefined,
    @Param('id') templateId: string,
    @Body() body: object,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const input = parseBody(CopyCampaignBodySchema, body)
    const id = randomUUID()
    const state: ScaleToWinMockCampaignState = {
      name: input.name,
      status: 'DRAFT',
      scriptVariants: input.scriptVariants,
      sendingPhoneNumber: input.sendingPhoneNumber,
      contactFields: input.contactFields,
      textingHoursTimezone: null,
      textingHoursStart: null,
      textingHoursEnd: null,
      startedAt: null,
      loadJob: null,
      scriptedLoadResult: null,
      startJob: null,
    }
    await this.vendorMockRecord.upsert(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.campaign,
      id,
      state,
      undefined,
      { route: 'copy', templateId },
    )
    return this.toCampaign(id, state)
  }

  @Get(CAMPAIGN_PATH)
  async getCampaign(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    return this.toCampaign(id, await this.loadCampaign(id))
  }

  @Post(`${CAMPAIGN_PATH}/preview-messages`)
  @HttpCode(HttpStatus.OK)
  async previewMessages(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: object,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    parseBody(PreviewMessagesBodySchema, body)
    await this.loadCampaign(id)
    return {
      messages: [{ status: 'SENT', providerErrorCode: null }],
      errors: [],
    }
  }

  @Post('uploads/presigned-put')
  @HttpCode(HttpStatus.OK)
  async presignedPut(
    @Headers('authorization') auth: string | undefined,
    @Body() body: object,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const input = parseBody(PresignedPutBodySchema, body)
    const token = randomUUID()
    await this.vendorMockRecord.upsert(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.upload,
      token,
      { fileName: input.fileName, rowCount: null },
    )
    const base = vendorBaseUrl('scaleToWin', S2W_API_BASE_URL)
    return { signedPutUrl: `${base}/mock-uploads/${token}`, token }
  }

  // Stands in for the presigned S3 PUT, which carries no auth header: the
  // token in the path is the credential. Only the row count is kept.
  @Put('mock-uploads/:token')
  @HttpCode(HttpStatus.OK)
  async putUpload(@Param('token') token: string, @Body() body: string) {
    this.assertMockMode()
    const record = await this.vendorMockRecord.findOne(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.upload,
      token,
    )
    if (!record) throw new NotFoundException()
    await this.vendorMockRecord.patchState(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.upload,
      token,
      { rowCount: countCsvRows(typeof body === 'string' ? body : '') },
    )
  }

  @Post(`${CAMPAIGN_PATH}/contacts/csv-upload`)
  @HttpCode(HttpStatus.OK)
  async csvUpload(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: object,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const input = parseBody(CsvUploadBodySchema, body)
    const campaign = await this.loadCampaign(id)
    if (
      campaign.loadJob?.status === 'RUNNING' ||
      campaign.startJob?.status === 'RUNNING'
    ) {
      throw vendorError(
        HttpStatus.CONFLICT,
        'A job is already running for this campaign',
        'CONFLICT',
      )
    }
    const upload = await this.vendorMockRecord.findOne(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.upload,
      input.uploadToken,
    )
    if (!upload) {
      throw vendorError(
        HttpStatus.BAD_REQUEST,
        'Unknown upload token',
        'INVALID_UPLOAD_TOKEN',
      )
    }
    const { rowCount } = ScaleToWinMockUploadStateSchema.parse(upload.state)
    // The mock finishes the load at once; Scale to Win runs it in the
    // background and the client polls GET contacts either way.
    await this.vendorMockRecord.patchState(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.campaign,
      id,
      {
        loadJob: {
          status: 'DONE',
          rowCount: rowCount ?? input.estimatedRowCount,
        },
      },
      {
        route: 'csv-upload',
        estimatedRowCount: input.estimatedRowCount,
        phoneNumberColumn: input.phoneNumberColumn,
        contactFieldMapping: input.contactFieldMapping,
      },
    )
    return { status: 'RUNNING' }
  }

  @Get(`${CAMPAIGN_PATH}/contacts`)
  async getLoadJob(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const { loadJob, scriptedLoadResult } = await this.loadCampaign(id)
    if (!loadJob) return { status: 'NOT_RUNNING' }
    return {
      status: loadJob.status,
      error: null,
      result: scriptedLoadResult ?? {
        nContacts: loadJob.rowCount,
        nInvalid: 0,
        nDuplicates: 0,
        nOptOuts: 0,
        nNotSubscribed: 0,
        nLandlines: 0,
        nFilteredOut: 0,
        importedFieldNames: [],
      },
    }
  }

  @Post(`${CAMPAIGN_PATH}/start`)
  @HttpCode(HttpStatus.OK)
  async start(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const campaign = await this.loadCampaign(id)
    if (campaign.loadJob?.status !== 'DONE') {
      throw vendorError(
        HttpStatus.CONFLICT,
        'Campaign has no loaded contacts',
        'CONFLICT',
      )
    }
    await this.vendorMockRecord.patchState(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.campaign,
      id,
      { status: 'INITIAL_SEND_READY', startJob: { status: 'DONE' } },
      { route: 'start' },
    )
    return { status: 'RUNNING' }
  }

  @Get(`${CAMPAIGN_PATH}/start`)
  async getStartJob(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const { startJob } = await this.loadCampaign(id)
    return startJob
      ? { status: startJob.status, error: null }
      : { status: 'NOT_RUNNING' }
  }

  @Post(`${CAMPAIGN_PATH}/send-full`)
  @HttpCode(HttpStatus.OK)
  async sendFull(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertMockMode()
    this.assertAuth(auth)
    const campaign = await this.loadCampaign(id)
    if (campaign.status !== 'INITIAL_SEND_READY') {
      throw vendorError(
        HttpStatus.CONFLICT,
        'Campaign is not ready to send',
        'CONFLICT',
      )
    }
    const next: ScaleToWinMockCampaignState = {
      ...campaign,
      status: 'INITIAL_SEND_RUNNING',
      startedAt: formatISO(new Date()),
    }
    await this.vendorMockRecord.patchState(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.campaign,
      id,
      { status: next.status, startedAt: next.startedAt },
      { route: 'send-full' },
    )
    return this.toCampaign(id, next)
  }

  private async loadCampaign(id: string) {
    const record = await this.vendorMockRecord.findOne(
      VendorMockVendor.scale_to_win,
      SCALE_TO_WIN_MOCK_KIND.campaign,
      id,
    )
    if (!record) {
      throw vendorError(
        HttpStatus.NOT_FOUND,
        'No campaign with that ID found in that subaccount',
        'NOT_FOUND',
      )
    }
    return ScaleToWinMockCampaignStateSchema.parse(record.state)
  }

  private toCampaign(
    id: string,
    state: ScaleToWinMockCampaignState,
  ): ScaleToWinCampaign {
    const loaded =
      state.loadJob?.status === 'DONE'
        ? (state.scriptedLoadResult?.nContacts ?? state.loadJob.rowCount)
        : 0
    return {
      id,
      name: state.name,
      status: state.status,
      scriptVariants: state.scriptVariants,
      textingHoursTimezone: state.textingHoursTimezone,
      textingHoursStart: state.textingHoursStart,
      textingHoursEnd: state.textingHoursEnd,
      startedAt: state.startedAt,
      contactCount: loaded,
      sendingPhoneNumber: state.sendingPhoneNumber,
      adminUrl: null,
    }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  // Mock routes are internet-facing on previews, so only the fixed mock
  // credentials the client sends in mock mode are accepted.
  private assertAuth(auth: string | undefined) {
    if (auth !== MOCK_AUTH) {
      throw vendorError(HttpStatus.UNAUTHORIZED, 'Unauthorized', 'UNAUTHORIZED')
    }
  }
}
