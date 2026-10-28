import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  BulkEmailEntry,
  BulkEmailStatus,
  CreateEmailTemplateCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  DeleteEmailTemplateCommand,
  DeleteTenantResourceAssociationCommand,
  GetAccountCommand,
  GetTenantCommand,
  SendBulkEmailCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2'
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch'
import { ServiceException } from '@smithy/smithy-client'
import { PinoLogger } from 'nestjs-pino'
import { AwsService } from '@/vendors/aws/services/aws.service'
import {
  OTEL_SERVICE_ENVIRONMENT,
  vendorBaseUrl,
  VENDOR_MODE,
} from '@/shared/util/appEnvironment.util'
import { EMAIL_OUTREACH_DOMAIN } from '../emailOutreach.const'

export const SES_REGION = 'us-west-2'

// Dev and prod share one AWS account, so tenants, templates and
// configuration sets carry the environment, and the task role can only touch
// names with its own prefix. A live deploy with no environment name would
// send under another environment's names, so it fails instead of guessing.
export const sesEnvironment = (): string => {
  if (OTEL_SERVICE_ENVIRONMENT) return OTEL_SERVICE_ENVIRONMENT
  if (VENDOR_MODE === 'mock') return 'local'
  throw new Error('OTEL_SERVICE_ENVIRONMENT is required to send through SES')
}

export const outreachConfigurationSet = (): string =>
  `outreach-${sesEnvironment()}`

export const forwardsConfigurationSet = (): string =>
  `forwards-${sesEnvironment()}`

// Marks our own forwards, so one that comes back to an inbox of ours is
// never forwarded again.
export const FORWARD_MARKER_HEADER = 'X-GoodParty-Forwarded'

// SES rejects a raw non-ASCII display name, so it goes out as an RFC 2047
// encoded word.
const displayName = (name: string): string =>
  /^[\x20-\x7e]*$/.test(name)
    ? `"${name}"`
    : `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`

const SES_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const sesTenantNameFor = (organizationSlug: string): string => {
  const name = `${sesEnvironment()}-${organizationSlug}`
  if (SES_NAME_PATTERN.test(name)) return name
  const digest = createHash('sha256')
    .update(organizationSlug)
    .digest('hex')
    .slice(0, 32)
  return `${sesEnvironment()}-org-${digest}`
}

export const sesTemplateNameFor = (outreachEmailId: number): string =>
  `${sesEnvironment()}-email-${outreachEmailId}`

export const SEND_TAG_NAME = 'outreachEmailId'

export interface SesSendInput {
  from: string
  to: string
  subject: string
  html: string
  text: string
  tenantName?: string
}

export interface SesForwardInput {
  from: string
  fromName: string
  replyTo: string
  to: string
  subject: string
  text: string
}

export type SesTemplateContent = {
  subject: string
  html: string
  text: string
}

export type SesBulkInput = {
  from: string
  tenantName: string
  templateName: string
  outreachEmailId: number
  entries: BulkEmailEntry[]
}

export type SesBulkEntryResult = {
  status: BulkEmailStatus | undefined
  messageId: string | undefined
  error: string | undefined
}

// What a whole SendBulkEmail call came back with. A paused tenant throws
// MessageRejected naming the tenant ARN ("Sending disabled for
// <arn:...:tenant/...>"), found by pausing a dev tenant by hand.
export type SesBulkOutcome =
  | { kind: 'sent'; results: SesBulkEntryResult[] }
  | { kind: 'throttled' }
  | { kind: 'quota' }
  | { kind: 'account_paused'; message: string }
  | { kind: 'tenant_paused'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'error'; err: Error }

export type SesAccountState = {
  sendingEnabled: boolean
  max24HourSend: number
  maxSendRate: number
  sentLast24Hours: number
}

export type SesSendMetrics = {
  send: number
  bounce: number
  complaint: number
  renderingFailure: number
}

// SES's documentation names the rendering-failure event both ways; querying
// both costs nothing when one has no data.
const METRIC_QUERIES: {
  id: string
  name: string
  key: keyof SesSendMetrics
}[] = [
  { id: 'send', name: 'Send', key: 'send' },
  { id: 'bounce', name: 'Bounce', key: 'bounce' },
  { id: 'complaint', name: 'Complaint', key: 'complaint' },
  { id: 'render1', name: 'Rendering Failure', key: 'renderingFailure' },
  { id: 'render2', name: 'RenderingFailure', key: 'renderingFailure' },
]
const METRIC_PERIOD_SECONDS = 60

const TENANT_ARN = /:tenant\//

// Shorter than the sweep lease (90 seconds), so a hung call can't outlive
// the runner's claim on sending.
const SES_REQUEST_TIMEOUT_MS = 30_000
const SES_CONNECTION_TIMEOUT_MS = 5_000

const errorName = (err: Error): string =>
  err instanceof ServiceException ? err.name : ''

const isAlreadyExists = (err: Error): boolean =>
  errorName(err) === 'AlreadyExistsException'

@Injectable()
export class SesService extends AwsService {
  private readonly client: SESv2Client
  private readonly cloudwatch: CloudWatchClient

  constructor(protected readonly logger: PinoLogger) {
    super(logger)
    this.logger.setContext(SesService.name)
    // Only set in mock mode; live leaves it unset so the SDK resolves the
    // regional endpoint itself. The mock never checks a signature, and a mock
    // run has no AWS session to resolve credentials from.
    const mock = VENDOR_MODE === 'mock'
    const mockCredentials = { accessKeyId: 'mock', secretAccessKey: 'mock' }
    const requestHandler = {
      requestTimeout: SES_REQUEST_TIMEOUT_MS,
      connectionTimeout: SES_CONNECTION_TIMEOUT_MS,
    }
    this.client = new SESv2Client({
      region: SES_REGION,
      requestHandler,
      // SendBulkEmail isn't idempotent: the SDK's own retry of a timeout or
      // 5xx can resend a batch SES already accepted. The sweep requeues a
      // failed batch for its next tick, and every other call here is either
      // safe to repeat or retried by its caller.
      maxAttempts: 1,
      ...(mock
        ? { endpoint: vendorBaseUrl('ses', ''), credentials: mockCredentials }
        : {}),
    })
    this.cloudwatch = new CloudWatchClient({
      region: SES_REGION,
      requestHandler,
      ...(mock
        ? {
            endpoint: `${vendorBaseUrl('ses', '')}/cloudwatch`,
            credentials: mockCredentials,
          }
        : {}),
    })
  }

  async sendEmail(input: SesSendInput): Promise<string | undefined> {
    return this.executeAwsOperation(async () => {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: input.from,
          Destination: { ToAddresses: [input.to] },
          ConfigurationSetName: outreachConfigurationSet(),
          ...(input.tenantName ? { TenantName: input.tenantName } : {}),
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: input.html, Charset: 'UTF-8' },
                Text: { Data: input.text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      )
      return result.MessageId
    }, 'sesSendEmail')
  }

  // A reply passed on to the sender's forward-to address. It uses the
  // forwards configuration set, which has no event destination, and no
  // tenant, so replies never touch a send's CloudWatch numbers.
  async forwardReply(input: SesForwardInput): Promise<string | undefined> {
    return this.executeAwsOperation(async () => {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: input.fromName
            ? `${displayName(input.fromName)} <${input.from}>`
            : input.from,
          Destination: { ToAddresses: [input.to] },
          ReplyToAddresses: [input.replyTo],
          ConfigurationSetName: forwardsConfigurationSet(),
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: input.text, Charset: 'UTF-8' } },
              Headers: [{ Name: FORWARD_MARKER_HEADER, Value: '1' }],
            },
          },
        }),
      )
      return result.MessageId
    }, 'sesForwardReply')
  }

  // Creates the tenant and associates the identity and the outreach
  // configuration set. Each call tolerates "already exists", so a retried
  // prepare finishes what an earlier attempt started.
  async ensureTenant(tenantName: string): Promise<void> {
    const tenantArn = await this.executeAwsOperation(async () => {
      try {
        const created = await this.client.send(
          new CreateTenantCommand({ TenantName: tenantName }),
        )
        return created.TenantArn
      } catch (err) {
        if (!(err instanceof Error) || !isAlreadyExists(err)) throw err
        const existing = await this.client.send(
          new GetTenantCommand({ TenantName: tenantName }),
        )
        return existing.Tenant?.TenantArn
      }
    }, 'sesEnsureTenant')
    const accountId = tenantArn?.split(':').at(4)
    if (!accountId) {
      throw new Error(`SES returned no account for tenant ${tenantName}`)
    }
    await this.associate(
      tenantName,
      this.arn(accountId, `identity/${EMAIL_OUTREACH_DOMAIN}`),
    )
    await this.associate(
      tenantName,
      this.arn(accountId, `configuration-set/${outreachConfigurationSet()}`),
    )
  }

  async createTemplate(
    tenantName: string,
    templateName: string,
    content: SesTemplateContent,
  ): Promise<void> {
    await this.executeAwsOperation(async () => {
      try {
        await this.client.send(
          new CreateEmailTemplateCommand({
            TemplateName: templateName,
            TemplateContent: {
              Subject: content.subject,
              Html: content.html,
              Text: content.text,
            },
          }),
        )
      } catch (err) {
        if (!(err instanceof Error) || !isAlreadyExists(err)) throw err
      }
    }, 'sesCreateTemplate')
    const accountId = await this.accountIdForTenant(tenantName)
    await this.associate(
      tenantName,
      this.arn(accountId, `template/${templateName}`),
    )
  }

  // SES refuses to delete a template that is still associated with a tenant,
  // so the association goes first. A missing one counts as done.
  async deleteTemplate(tenantName: string, templateName: string) {
    const accountId = await this.accountIdForTenant(tenantName)
    await this.executeAwsOperation(async () => {
      try {
        await this.client.send(
          new DeleteTenantResourceAssociationCommand({
            TenantName: tenantName,
            ResourceArn: this.arn(accountId, `template/${templateName}`),
          }),
        )
      } catch (err) {
        if (!(err instanceof Error) || errorName(err) !== 'NotFoundException')
          throw err
      }
      try {
        await this.client.send(
          new DeleteEmailTemplateCommand({ TemplateName: templateName }),
        )
      } catch (err) {
        if (!(err instanceof Error) || errorName(err) !== 'NotFoundException')
          throw err
      }
    }, 'sesDeleteTemplate')
  }

  async sendBulk(input: SesBulkInput): Promise<SesBulkOutcome> {
    try {
      const result = await this.client.send(
        new SendBulkEmailCommand({
          FromEmailAddress: input.from,
          ConfigurationSetName: outreachConfigurationSet(),
          TenantName: input.tenantName,
          DefaultContent: {
            Template: {
              TemplateName: input.templateName,
              TemplateData: '{}',
            },
          },
          DefaultEmailTags: [
            { Name: SEND_TAG_NAME, Value: String(input.outreachEmailId) },
          ],
          BulkEmailEntries: input.entries,
        }),
      )
      return {
        kind: 'sent',
        results: (result.BulkEmailEntryResults ?? []).map((entry) => ({
          status: entry.Status,
          messageId: entry.MessageId,
          error: entry.Error,
        })),
      }
    } catch (err) {
      if (!(err instanceof Error)) throw err
      switch (errorName(err)) {
        case 'TooManyRequestsException':
          return { kind: 'throttled' }
        case 'LimitExceededException':
          return { kind: 'quota' }
        case 'SendingPausedException':
        case 'AccountSuspendedException':
          return { kind: 'account_paused', message: err.message }
        case 'MessageRejected':
          return TENANT_ARN.test(err.message)
            ? { kind: 'tenant_paused', message: err.message }
            : { kind: 'rejected', message: err.message }
        default:
          // A client fault won't succeed on a retry, so the send is paused
          // rather than retried every tick ahead of everyone else's.
          return err instanceof ServiceException && err.$fault === 'client'
            ? { kind: 'rejected', message: `${err.name}: ${err.message}` }
            : { kind: 'error', err }
      }
    }
  }

  async getAccount(): Promise<SesAccountState> {
    return this.executeAwsOperation(async () => {
      const account = await this.client.send(new GetAccountCommand({}))
      return {
        sendingEnabled: account.SendingEnabled ?? false,
        max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
        maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
        sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
      }
    }, 'sesGetAccount')
  }

  // The outreach configuration set publishes these under the send's tag
  // alone (checked in dev), so the dimension set is exactly that one.
  async getSendMetrics(
    outreachEmailId: number,
    start: Date,
    end: Date,
  ): Promise<SesSendMetrics> {
    return this.executeAwsOperation(async () => {
      const result = await this.cloudwatch.send(
        new GetMetricDataCommand({
          StartTime: start,
          EndTime: end,
          MetricDataQueries: METRIC_QUERIES.map(({ id, name }) => ({
            Id: id,
            MetricStat: {
              Metric: {
                Namespace: 'AWS/SES',
                MetricName: name,
                Dimensions: [
                  { Name: SEND_TAG_NAME, Value: String(outreachEmailId) },
                ],
              },
              Period: METRIC_PERIOD_SECONDS,
              Stat: 'Sum',
            },
          })),
        }),
      )
      const totals: SesSendMetrics = {
        send: 0,
        bounce: 0,
        complaint: 0,
        renderingFailure: 0,
      }
      for (const series of result.MetricDataResults ?? []) {
        const query = METRIC_QUERIES.find((q) => q.id === series.Id)
        if (!query) continue
        totals[query.key] += (series.Values ?? []).reduce((a, b) => a + b, 0)
      }
      return totals
    }, 'cloudwatchGetSendMetrics')
  }

  private async associate(tenantName: string, resourceArn: string) {
    await this.executeAwsOperation(async () => {
      try {
        await this.client.send(
          new CreateTenantResourceAssociationCommand({
            TenantName: tenantName,
            ResourceArn: resourceArn,
          }),
        )
      } catch (err) {
        if (!(err instanceof Error) || !isAlreadyExists(err)) throw err
      }
    }, 'sesAssociateTenantResource')
  }

  private async accountIdForTenant(tenantName: string): Promise<string> {
    const tenant = await this.executeAwsOperation(
      () => this.client.send(new GetTenantCommand({ TenantName: tenantName })),
      'sesGetTenant',
    )
    const accountId = tenant.Tenant?.TenantArn?.split(':').at(4)
    if (!accountId) {
      throw new Error(`SES returned no account for tenant ${tenantName}`)
    }
    return accountId
  }

  private arn(accountId: string, resource: string): string {
    return `arn:aws:ses:${SES_REGION}:${accountId}:${resource}`
  }
}
