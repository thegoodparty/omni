/**
 * Checks, against real SES in dev, the two assumptions the email send sweep
 * rests on, before it is built (Implementation Notes, "How we test it", layer 4):
 *
 * 1. Metric timing. Sends a small batch to the SES mailbox simulator through a
 *    throwaway dev tenant, tagged `outreachEmailId`, and times how long `Send`,
 *    `Bounce` and `Complaint` take to appear in CloudWatch under that
 *    dimension. It lists the metrics first, so it also prints the exact metric
 *    names and dimension sets the auto-pause query has to use.
 * 2. Paused tenant. Disables the tenant by hand
 *    (`UpdateReputationEntityCustomerManagedStatus`) and records exactly what
 *    `SendBulkEmail` and `SendEmail` return while it is paused.
 *
 * It sends only to `*@simulator.amazonses.com`, which costs normal SES rates
 * but never counts against reputation or the suppression list. It creates the
 * tenant `dev-c3-probe-<run>` and the template of the same name, and deletes
 * both at the end unless `--keep` is passed.
 *
 * Usage (a dev session with SES and CloudWatch access, e.g. /breakglass):
 *   npx tsx scripts/ses-dev-assumptions-check.ts --confirm-dev
 *
 * Options:
 *   --confirm-dev           Required. Refuses to run without it.
 *   --per-address <n>       Emails to each simulator address. Default 10.
 *   --max-minutes <n>       How long to wait for metrics. Default 30.
 *   --skip-metrics          Only run the paused-tenant check.
 *   --skip-pause            Only run the metric-timing check.
 *   --keep                  Leave the tenant and template in place.
 */

import {
  CreateEmailTemplateCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  DeleteEmailTemplateCommand,
  DeleteTenantCommand,
  GetAccountCommand,
  GetReputationEntityCommand,
  GetTenantCommand,
  SendBulkEmailCommand,
  SendEmailCommand,
  SESv2Client,
  UpdateReputationEntityCustomerManagedStatusCommand,
} from '@aws-sdk/client-sesv2'
import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
  type Dimension,
} from '@aws-sdk/client-cloudwatch'

const REGION = 'us-west-2'
const IDENTITY = 'outreachmail-dev.goodparty.org'
const CONFIGURATION_SET = 'outreach-dev'
const FROM = `c3-probe@${IDENTITY}`
const SIMULATOR = {
  success: 'success@simulator.amazonses.com',
  bounce: 'bounce@simulator.amazonses.com',
  complaint: 'complaint@simulator.amazonses.com',
} as const

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const numberArg = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(args[index + 1])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} needs a positive number`)
  }
  return value
}

const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const tenantName = `dev-c3-probe-${runId}`
const templateName = `dev-c3-probe-${runId}`
const outreachEmailId = `c3-probe-${runId}`

const ses = new SESv2Client({ region: REGION })
const cloudwatch = new CloudWatchClient({ region: REGION })

const startedAt = Date.now()
const stamp = () => `[+${Math.round((Date.now() - startedAt) / 1000)}s]`
const log = (...parts: Array<string | number>) => console.log(stamp(), ...parts)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const describeError = (error: Error) => {
  const meta = error as Error & {
    $fault?: string
    $metadata?: { httpStatusCode?: number; requestId?: string }
    Code?: string
  }
  return {
    name: error.name,
    code: meta.Code,
    message: error.message,
    fault: meta.$fault,
    httpStatusCode: meta.$metadata?.httpStatusCode,
    requestId: meta.$metadata?.requestId,
  }
}

const tolerateExists = async (label: string, call: () => Promise<object>) => {
  try {
    await call()
    log(`${label}: created`)
  } catch (error) {
    if (error instanceof Error && error.name === 'AlreadyExistsException') {
      log(`${label}: already exists`)
      return
    }
    throw error
  }
}

const accountArn = (accountId: string, resource: string) =>
  `arn:aws:ses:${REGION}:${accountId}:${resource}`

const setUp = async () => {
  const account = await ses.send(new GetAccountCommand({}))
  log(
    'GetAccount',
    JSON.stringify({
      SendingEnabled: account.SendingEnabled,
      ProductionAccessEnabled: account.ProductionAccessEnabled,
      SendQuota: account.SendQuota,
    }),
  )

  const tenant = await ses.send(
    new CreateTenantCommand({ TenantName: tenantName }),
  )
  const tenantArn = tenant.TenantArn
  if (!tenantArn) throw new Error('CreateTenant returned no TenantArn')
  const accountId = tenantArn.split(':').at(4)
  if (!accountId) throw new Error(`Unexpected tenant ARN ${tenantArn}`)
  log('CreateTenant', JSON.stringify({ tenantName, tenantArn }))

  await tolerateExists('identity association', () =>
    ses.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: accountArn(accountId, `identity/${IDENTITY}`),
      }),
    ),
  )
  await tolerateExists('configuration set association', () =>
    ses.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: accountArn(
          accountId,
          `configuration-set/${CONFIGURATION_SET}`,
        ),
      }),
    ),
  )
  await tolerateExists('template', () =>
    ses.send(
      new CreateEmailTemplateCommand({
        TemplateName: templateName,
        TemplateContent: {
          Subject: 'C3 probe {{first_name}}',
          Html: '<p>Hello {{first_name}}, this is a C3 probe.</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
          Text: 'Hello {{first_name}}, this is a C3 probe. Unsubscribe: {{unsubscribe_url}}',
        },
      }),
    ),
  )
  await tolerateExists('template association', () =>
    ses.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: accountArn(accountId, `template/${templateName}`),
      }),
    ),
  )
  return { tenantArn, accountId }
}

const bulkSend = (addresses: string[]) =>
  ses.send(
    new SendBulkEmailCommand({
      FromEmailAddress: FROM,
      ConfigurationSetName: CONFIGURATION_SET,
      TenantName: tenantName,
      DefaultContent: {
        Template: {
          TemplateName: templateName,
          TemplateData: JSON.stringify({
            first_name: 'there',
            unsubscribe_url: 'https://example.com',
          }),
        },
      },
      DefaultEmailTags: [{ Name: 'outreachEmailId', Value: outreachEmailId }],
      BulkEmailEntries: addresses.map((address, index) => ({
        Destination: { ToAddresses: [address] },
        ReplacementEmailContent: {
          ReplacementTemplate: {
            ReplacementTemplateData: JSON.stringify({
              first_name: `Probe${index}`,
              unsubscribe_url: `https://gp-api-dev.goodparty.org/v1/email/unsubscribe/one-click?t=probe${index}`,
            }),
          },
        },
        ReplacementHeaders: [
          {
            Name: 'List-Unsubscribe',
            Value: `<https://gp-api-dev.goodparty.org/v1/email/unsubscribe/one-click?t=probe${index}>`,
          },
          {
            Name: 'List-Unsubscribe-Post',
            Value: 'List-Unsubscribe=One-Click',
          },
        ],
      })),
    }),
  )

const summarizeEntries = (
  results: Array<{ Status?: string; Error?: string; MessageId?: string }>,
) => {
  const counts: Record<string, number> = {}
  for (const entry of results) {
    const key = `${entry.Status ?? 'NO_STATUS'}${entry.Error ? `: ${entry.Error}` : ''}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

const sumMetrics = async (since: Date) => {
  const listed = await cloudwatch.send(
    new ListMetricsCommand({
      Namespace: 'AWS/SES',
      Dimensions: [{ Name: 'outreachEmailId', Value: outreachEmailId }],
    }),
  )
  const metrics = (listed.Metrics ?? []).filter(
    (metric): metric is { MetricName: string; Dimensions: Dimension[] } =>
      Boolean(metric.MetricName && metric.Dimensions),
  )
  if (metrics.length === 0) return { metrics, sums: {} }
  const data = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: new Date(since.getTime() - 5 * 60_000),
      EndTime: new Date(Date.now() + 60_000),
      MetricDataQueries: metrics.map((metric, index) => ({
        Id: `m${index}`,
        Label: metric.MetricName,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/SES',
            MetricName: metric.MetricName,
            Dimensions: metric.Dimensions,
          },
          Period: 60,
          Stat: 'Sum',
        },
      })),
    }),
  )
  const sums: Record<string, number> = {}
  for (const result of data.MetricDataResults ?? []) {
    const name = result.Label ?? result.Id ?? 'unknown'
    sums[name] =
      (sums[name] ?? 0) + (result.Values ?? []).reduce((a, b) => a + b, 0)
  }
  return { metrics, sums }
}

const checkMetricTiming = async () => {
  const perAddress = numberArg('per-address', 10)
  const maxMinutes = numberArg('max-minutes', 30)
  const addresses = [
    ...Array<string>(perAddress).fill(SIMULATOR.success),
    ...Array<string>(perAddress).fill(SIMULATOR.bounce),
    ...Array<string>(perAddress).fill(SIMULATOR.complaint),
  ]
  const sentAt = new Date()
  const result = await bulkSend(addresses)
  log(
    'SendBulkEmail (metrics batch)',
    JSON.stringify(summarizeEntries(result.BulkEmailEntryResults ?? [])),
  )

  const expected: Record<string, number> = {
    Send: addresses.length,
    Bounce: perAddress,
    Complaint: perAddress,
  }
  const firstSeen: Record<string, number> = {}
  const complete: Record<string, number> = {}
  let printedDimensions = false
  const deadline = Date.now() + maxMinutes * 60_000

  while (Date.now() < deadline) {
    await sleep(30_000)
    let read: Awaited<ReturnType<typeof sumMetrics>>
    try {
      read = await sumMetrics(sentAt)
    } catch (error) {
      log(
        'CloudWatch read failed',
        JSON.stringify(
          error instanceof Error
            ? describeError(error)
            : { message: String(error) },
        ),
      )
      continue
    }
    if (!printedDimensions && read.metrics.length > 0) {
      printedDimensions = true
      log(
        'Metrics listed under the dimension',
        JSON.stringify(
          read.metrics.map((metric) => ({
            name: metric.MetricName,
            dimensions: metric.Dimensions,
          })),
        ),
      )
    }
    const secondsSinceSend = Math.round((Date.now() - sentAt.getTime()) / 1000)
    for (const [name, value] of Object.entries(read.sums)) {
      if (value > 0 && firstSeen[name] === undefined) {
        firstSeen[name] = secondsSinceSend
        log(`${name} first seen ${secondsSinceSend}s after send`)
      }
      if (
        expected[name] !== undefined &&
        value >= expected[name] &&
        complete[name] === undefined
      ) {
        complete[name] = secondsSinceSend
        log(
          `${name} reached ${value} (all expected) ${secondsSinceSend}s after send`,
        )
      }
    }
    log('sums so far', JSON.stringify(read.sums))
    if (Object.keys(expected).every((name) => complete[name] !== undefined)) {
      break
    }
  }
  return { expected, firstSeenSeconds: firstSeen, completeSeconds: complete }
}

const checkPausedTenant = async (tenantArn: string) => {
  const attempts: Array<Record<string, string | number | object | undefined>> =
    []
  const tryBoth = async (label: string) => {
    try {
      const result = await bulkSend([SIMULATOR.success])
      attempts.push({
        label,
        call: 'SendBulkEmail',
        outcome: 'returned',
        entries: result.BulkEmailEntryResults,
      })
    } catch (error) {
      attempts.push({
        label,
        call: 'SendBulkEmail',
        outcome: 'threw',
        error:
          error instanceof Error
            ? describeError(error)
            : { message: String(error) },
      })
    }
    try {
      const result = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          ConfigurationSetName: CONFIGURATION_SET,
          TenantName: tenantName,
          Destination: { ToAddresses: [SIMULATOR.success] },
          Content: {
            Simple: {
              Subject: { Data: 'C3 probe (paused)' },
              Body: { Text: { Data: 'Paused tenant probe.' } },
            },
          },
        }),
      )
      attempts.push({
        label,
        call: 'SendEmail',
        outcome: 'returned',
        messageId: result.MessageId,
      })
    } catch (error) {
      attempts.push({
        label,
        call: 'SendEmail',
        outcome: 'threw',
        error:
          error instanceof Error
            ? describeError(error)
            : { message: String(error) },
      })
    }
    log(label, JSON.stringify(attempts.slice(-2)))
  }

  await ses.send(
    new UpdateReputationEntityCustomerManagedStatusCommand({
      ReputationEntityType: 'RESOURCE',
      ReputationEntityReference: tenantArn,
      SendingStatus: 'DISABLED',
    }),
  )
  log('tenant set DISABLED')
  const entity = await ses.send(
    new GetReputationEntityCommand({
      ReputationEntityType: 'RESOURCE',
      ReputationEntityReference: tenantArn,
    }),
  )
  log('GetReputationEntity', JSON.stringify(entity.ReputationEntity))
  const tenant = await ses.send(
    new GetTenantCommand({ TenantName: tenantName }),
  )
  log('GetTenant SendingStatus', String(tenant.Tenant?.SendingStatus))

  // The pause may take a moment to reach the send path, so try until a send
  // is refused or five minutes pass.
  const deadline = Date.now() + 5 * 60_000
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    await tryBoth(`paused attempt ${attempt}`)
    const last = attempts.slice(-2)
    const refused = last.some(
      (entry) =>
        entry.outcome === 'threw' ||
        (Array.isArray(entry.entries) &&
          entry.entries.some(
            (result: { Status?: string }) => result.Status !== 'SUCCESS',
          )),
    )
    if (refused) break
    await sleep(30_000)
  }

  await ses.send(
    new UpdateReputationEntityCustomerManagedStatusCommand({
      ReputationEntityType: 'RESOURCE',
      ReputationEntityReference: tenantArn,
      SendingStatus: 'ENABLED',
    }),
  )
  log('tenant set ENABLED again')
  await sleep(10_000)
  await tryBoth('after re-enable')
  return attempts
}

const cleanUp = async () => {
  if (flag('keep')) {
    log(`--keep: leaving tenant and template ${tenantName}`)
    return
  }
  for (const [label, call] of [
    // SES refuses to delete a template a tenant still holds.
    [
      'DeleteTenant',
      () => ses.send(new DeleteTenantCommand({ TenantName: tenantName })),
    ],
    [
      'DeleteEmailTemplate',
      () =>
        ses.send(
          new DeleteEmailTemplateCommand({ TemplateName: templateName }),
        ),
    ],
  ] as const) {
    try {
      await call()
      log(`${label}: done`)
    } catch (error) {
      log(
        `${label} failed`,
        JSON.stringify(
          error instanceof Error
            ? describeError(error)
            : { message: String(error) },
        ),
      )
    }
  }
}

const main = async () => {
  if (!flag('confirm-dev')) {
    console.error(
      'Refusing to run without --confirm-dev. This sends real SES email to the mailbox simulator in dev.',
    )
    process.exit(1)
  }
  log(
    `run ${runId}: tenant ${tenantName}, tag outreachEmailId=${outreachEmailId}`,
  )
  const { tenantArn } = await setUp()
  const summary: Record<string, object | string> = {
    runId,
    tenantName,
    tenantArn,
  }
  try {
    if (!flag('skip-metrics')) summary.metricTiming = await checkMetricTiming()
    if (!flag('skip-pause'))
      summary.pausedTenant = await checkPausedTenant(tenantArn)
  } finally {
    await cleanUp()
  }
  console.log('\n===== Paste everything below this line back =====')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: Error) => {
  console.error('FAILED', JSON.stringify(describeError(error)), error.stack)
  process.exit(1)
})
