import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { z } from 'zod'
import { PinoLogger } from 'nestjs-pino'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { SES_MOCK_ACCOUNT_ID, sesMockState } from './sesMockState'

type JsonBody = Record<string, unknown>

const awsError = (status: HttpStatus, type: string, message: string) =>
  new HttpException({ __type: type, message }, status)

const stringField = (body: JsonBody | undefined, key: string): string => {
  const value = body?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw awsError(
      HttpStatus.BAD_REQUEST,
      'BadRequestException',
      `${key} is required`,
    )
  }
  return value
}

const tenantArn = (name: string) =>
  `arn:aws:ses:us-west-2:${SES_MOCK_ACCOUNT_ID}:tenant/${name}/tn-mock`

const BulkBodySchema = z.object({
  TenantName: z.string().optional(),
  DefaultEmailTags: z
    .array(z.object({ Name: z.string(), Value: z.string() }))
    .optional(),
  BulkEmailEntries: z.array(z.object({})),
})

const TenantStatusSchema = z.object({
  sendingStatus: z.enum(['ENABLED', 'DISABLED']),
})

const MetricsSchema = z.object({
  send: z.number().int().nonnegative().optional(),
  bounce: z.number().int().nonnegative().optional(),
  complaint: z.number().int().nonnegative().optional(),
  renderingFailure: z.number().int().nonnegative().optional(),
})

// SESv2 is a REST JSON API, so the SDK posts to each operation's own path
// under the mock's base URL. State lives in memory (sesMockState.ts): a
// preview runs one task, and tests run in-process. The `test/` routes script
// a paused tenant or a send's CloudWatch numbers.
@Controller('vendor-mocks/ses')
@PublicAccess()
export class SesMockController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SesMockController.name)
  }

  @Post('v2/email/outbound-emails')
  @HttpCode(HttpStatus.OK)
  sendEmail(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    const destination = body?.Destination
    if (!destination || typeof destination !== 'object') {
      throw new BadRequestException({
        message: 'Destination is required',
        __type: 'BadRequestException',
      })
    }
    const tenant = body?.TenantName
    if (typeof tenant === 'string') this.assertTenantSending(tenant)
    return { MessageId: `mock-${randomUUID()}` }
  }

  @Post('v2/email/outbound-bulk-emails')
  @HttpCode(HttpStatus.OK)
  sendBulkEmail(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    const parsed = BulkBodySchema.safeParse(body)
    if (!parsed.success) {
      throw awsError(
        HttpStatus.BAD_REQUEST,
        'BadRequestException',
        'BulkEmailEntries is required',
      )
    }
    const { TenantName, DefaultEmailTags, BulkEmailEntries } = parsed.data
    if (TenantName) this.assertTenantSending(TenantName)
    const tag = DefaultEmailTags?.find((t) => t.Name === 'outreachEmailId')
    sesMockState.recordSent(tag?.Value, BulkEmailEntries.length)
    return {
      BulkEmailEntryResults: BulkEmailEntries.map(() => ({
        Status: 'SUCCESS',
        MessageId: `mock-${randomUUID()}`,
      })),
    }
  }

  @Post('v2/email/tenants')
  @HttpCode(HttpStatus.OK)
  createTenant(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    const name = stringField(body, 'TenantName')
    if (sesMockState.tenants.has(name)) {
      throw awsError(
        HttpStatus.BAD_REQUEST,
        'AlreadyExistsException',
        `Tenant ${name} already exists`,
      )
    }
    sesMockState.tenants.set(name, { sendingStatus: 'ENABLED' })
    return {
      TenantName: name,
      TenantId: 'tn-mock',
      TenantArn: tenantArn(name),
      SendingStatus: 'ENABLED',
    }
  }

  @Post('v2/email/tenants/get')
  @HttpCode(HttpStatus.OK)
  getTenant(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    const name = stringField(body, 'TenantName')
    const tenant = sesMockState.tenants.get(name)
    if (!tenant) {
      throw awsError(
        HttpStatus.NOT_FOUND,
        'NotFoundException',
        `Tenant ${name} not found`,
      )
    }
    return {
      Tenant: {
        TenantName: name,
        TenantId: 'tn-mock',
        TenantArn: tenantArn(name),
        SendingStatus: tenant.sendingStatus,
      },
    }
  }

  @Post('v2/email/tenants/resources')
  @HttpCode(HttpStatus.OK)
  associate(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    stringField(body, 'TenantName')
    stringField(body, 'ResourceArn')
    return {}
  }

  @Post('v2/email/tenants/resources/delete')
  @HttpCode(HttpStatus.OK)
  disassociate(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    stringField(body, 'TenantName')
    stringField(body, 'ResourceArn')
    return {}
  }

  @Post('v2/email/templates')
  @HttpCode(HttpStatus.OK)
  createTemplate(@Body() body: JsonBody | undefined) {
    this.assertMockMode()
    const name = stringField(body, 'TemplateName')
    if (sesMockState.templates.has(name)) {
      throw awsError(
        HttpStatus.BAD_REQUEST,
        'AlreadyExistsException',
        `Template ${name} already exists`,
      )
    }
    sesMockState.templates.add(name)
    return {}
  }

  @Delete('v2/email/templates/:name')
  @HttpCode(HttpStatus.OK)
  deleteTemplate(@Param('name') name: string) {
    this.assertMockMode()
    sesMockState.templates.delete(name)
    return {}
  }

  @Get('v2/email/account')
  getAccount() {
    this.assertMockMode()
    return {
      SendingEnabled: true,
      ProductionAccessEnabled: true,
      SendQuota: {
        Max24HourSend: 50_000,
        MaxSendRate: 14,
        SentLast24Hours: 0,
      },
    }
  }

  @Post('test/tenants/:name/status')
  @HttpCode(HttpStatus.OK)
  setTenantStatus(@Param('name') name: string, @Body() body: JsonBody) {
    this.assertMockMode()
    const { sendingStatus } = TenantStatusSchema.parse(body)
    sesMockState.tenants.set(name, { sendingStatus })
    return { name, sendingStatus }
  }

  @Post('test/metrics/:outreachEmailId')
  @HttpCode(HttpStatus.OK)
  setMetrics(
    @Param('outreachEmailId') outreachEmailId: string,
    @Body() body: JsonBody,
  ) {
    this.assertMockMode()
    sesMockState.scriptedMetrics.set(outreachEmailId, MetricsSchema.parse(body))
    return sesMockState.metricsFor(outreachEmailId)
  }

  private assertTenantSending(name: string) {
    if (sesMockState.tenants.get(name)?.sendingStatus === 'DISABLED') {
      throw awsError(
        HttpStatus.BAD_REQUEST,
        'MessageRejected',
        `Sending disabled for <${tenantArn(name)}>. For more information, ` +
          'please check the resource configuration and status.',
      )
    }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }
}
