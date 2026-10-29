/**
 * The dev end-to-end runs for email outreach (Implementation Notes, "How we
 * test it", layer 4), against real SES and CloudWatch in dev.
 *
 * Deployed dev sends through the SES vendor mock, and `VENDOR_MODE=live` on
 * dev turns its crons off, so the deployed sweep never reaches real SES. This
 * script runs the real prepare, send sweep, auto-pause check, finish and
 * inbound services in a local process, against a local Postgres, with live
 * SES. Payment is out of scope here: each send gets a `held` hold row so
 * prepare accepts it, and the script finishes sends itself instead of
 * settling them (the release-train E2E spec covers confirm and pay).
 *
 * Scenarios (all by default; pick with `--only a,b`):
 *   paths      success, bounce, complaint and ooto through a new tenant:
 *              tenant and template creation, merge tags, per-recipient
 *              unsubscribe headers, CloudWatch numbers for the right send,
 *              finish deleting the template and holding warming back, and
 *              the ooto auto-reply arriving through SES inbound and being
 *              dropped
 *   autopause  a send to the bounce simulator and one to the complaint
 *              simulator, each sent in part, then ticked again once
 *              CloudWatch has the numbers: each must pause with the right
 *              reason and leave its remaining recipients queued
 *   pacing     three senders of 1,000 simulator addresses each, swept tick
 *              by tick like the cron: no throttling and a send rate at or
 *              under 90% of the account's MaxSendRate
 *
 * Only `*@simulator.amazonses.com` is ever addressed, and a reply that would
 * be forwarded goes to the simulator too. Each run uses its own
 * organizations, so each gets a fresh tenant (`dev-email-e2e-<run>-...`),
 * deleted at the end unless `--keep` is passed. Send ids are drawn from a
 * high range, because CloudWatch keys a send's numbers on its id alone and
 * dev and prod share the account.
 *
 * Usage, from packages/gp-api, with a dev AWS session that can use SES,
 * CloudWatch and the inbound bucket (e.g. /breakglass), and a migrated local
 * database. Not tsx: esbuild drops emitDecoratorMetadata.
 *
 *   OTEL_SERVICE_ENVIRONMENT=dev VENDOR_MODE=live \
 *   EMAIL_INBOUND_BUCKET=goodparty-email-inbound-dev \
 *   EMAIL_UNSUBSCRIBE_SIGNING_KEY=local-email-dev-e2e \
 *   node -r @swc-node/register -r tsconfig-paths/register \
 *     scripts/email-dev-e2e.ts --confirm-dev
 *
 * Options:
 *   --confirm-dev   Required. Refuses to run without it.
 *   --only <list>   Comma-separated scenarios: paths, autopause, pacing.
 *   --dry-run       Boot, check the environment and stop before any AWS call.
 *   --keep          Leave the tenants in place.
 */
import '../src/configrc'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { INestApplicationContext } from '@nestjs/common'
import {
  DeleteTenantCommand,
  GetEmailTemplateCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { addDays, subMinutes } from 'date-fns'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '../src/generated/prisma'
import { loggerModule } from '../src/observability/logging/logger-module'
import { PrismaModule } from '../src/prisma/prisma.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { PaymentHoldsService } from '../src/paymentHolds/services/paymentHolds.service'
import { QueueProducerService } from '../src/queue/producer/queueProducer.service'
import {
  IS_PROD_DEPLOY,
  VENDOR_MODE,
} from '../src/shared/util/appEnvironment.util'
import { AwsModule } from '../src/vendors/aws/aws.module'
import { SlackModule } from '../src/vendors/slack/slack.module'
import { EMAIL_OUTREACH_DOMAIN } from '../src/emailOutreach/emailOutreach.const'
import { OutreachEmailInboundService } from '../src/emailOutreach/services/outreachEmailInbound.service'
import { OutreachEmailLifecycleService } from '../src/emailOutreach/services/outreachEmailLifecycle.service'
import { OutreachEmailPauseAlertService } from '../src/emailOutreach/services/outreachEmailPauseAlert.service'
import { OutreachEmailPrepareService } from '../src/emailOutreach/services/outreachEmailPrepare.service'
import { OutreachEmailSendSweepService } from '../src/emailOutreach/services/outreachEmailSendSweep.service'
import { OutreachEmailUnsubscribeService } from '../src/emailOutreach/services/outreachEmailUnsubscribe.service'
import {
  SES_REGION,
  SesService,
  sesEnvironment,
} from '../src/emailOutreach/services/ses.service'

const SCENARIOS = ['paths', 'autopause', 'pacing'] as const
type Scenario = (typeof SCENARIOS)[number]

const SIMULATOR_DOMAIN = 'simulator.amazonses.com'
const FORWARD_TO = `success@${SIMULATOR_DOMAIN}`
const CRON_PERIOD_MS = 60_000
// Long enough for a partial send to pass the 500-send auto-pause floor, short
// enough to leave recipients queued for the tick that should pause.
const PARTIAL_TICK_MS = 45_000
const METRICS_WAIT_MS = 15 * 60_000
const INBOUND_WAIT_MS = 10 * 60_000
const POLL_MS = 20_000
const INBOUND_CLOCK_SLACK_MINUTES = 5

// The script's own copy of the services it drives. The lifecycle service's
// hold and queue dependencies are never reached by `finish`, so they are
// given empty stand-ins rather than their modules.
@Module({
  imports: [loggerModule, PrismaModule, AwsModule, SlackModule],
  providers: [
    SesService,
    OutreachEmailPrepareService,
    OutreachEmailSendSweepService,
    OutreachEmailPauseAlertService,
    OutreachEmailUnsubscribeService,
    OutreachEmailInboundService,
    OutreachEmailLifecycleService,
    { provide: PaymentHoldsService, useValue: {} },
    { provide: QueueProducerService, useValue: {} },
  ],
})
class EmailDevE2eModule {}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const listArg = (name: string): string[] | null => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return null
  return (args[index + 1] ?? '').split(',').filter(Boolean)
}

const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 12)
const startedAt = Date.now()
const stamp = () => `[+${Math.round((Date.now() - startedAt) / 1000)}s]`
const log = (...parts: Array<string | number>) => console.log(stamp(), ...parts)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Check = { scenario: Scenario; name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (
  scenario: Scenario,
  name: string,
  ok: boolean,
  detail: object | string,
) => {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  checks.push({ scenario, name, ok, detail: text })
  log(`${ok ? 'PASS' : 'FAIL'} ${scenario}: ${name}`, text)
}

const simulator = (kind: string, count: number) =>
  Array.from(
    { length: count },
    (_, i) => `${kind}+e2e${runId}n${i}@${SIMULATOR_DOMAIN}`,
  )

// CloudWatch keys a send's numbers on its id alone, and dev and prod share
// the account, so a small local id could read another send's numbers.
let nextSendId = 1_900_000_000 + Math.floor(Math.random() * 200_000_000)

const refuseUnlessSafe = () => {
  const problems: string[] = []
  if (!flag('confirm-dev')) problems.push('pass --confirm-dev')
  if (IS_PROD_DEPLOY) problems.push('OTEL_SERVICE_ENVIRONMENT is prod')
  if (VENDOR_MODE !== 'live') problems.push('VENDOR_MODE must be live')
  let environment = ''
  try {
    environment = sesEnvironment()
  } catch {
    problems.push('OTEL_SERVICE_ENVIRONMENT is unset')
  }
  if (environment && environment !== 'dev') {
    problems.push(`OTEL_SERVICE_ENVIRONMENT must be dev, not ${environment}`)
  }
  if (!process.env.EMAIL_UNSUBSCRIBE_SIGNING_KEY) {
    problems.push('EMAIL_UNSUBSCRIBE_SIGNING_KEY must be set (any value)')
  }
  if (process.env.EMAIL_INBOUND_BUCKET !== 'goodparty-email-inbound-dev') {
    problems.push('EMAIL_INBOUND_BUCKET must be goodparty-email-inbound-dev')
  }
  const databaseHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname
    } catch {
      return ''
    }
  })()
  if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    problems.push(`DATABASE_URL must be a local database, not ${databaseHost}`)
  }
  if (problems.length > 0) {
    console.error(`Refusing to run:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
}

const selectedScenarios = (): Scenario[] => {
  const only = listArg('only')
  if (!only) return [...SCENARIOS]
  const unknown = only.filter((s) => !SCENARIOS.some((known) => known === s))
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}`)
  }
  return SCENARIOS.filter((s) => only.includes(s))
}

type Fixture = {
  organizationSlug: string
  senderId: number
  localPart: string
  outreachId: number
  outreachEmailId: number
}

const tenantsCreated = new Set<string>()

// A Pro campaign organization with a sender that has no tenant yet, and one
// in_progress, unprepared send on a held hold: the state the due sweep leaves
// a send in before prepare runs.
const createFixture = async (
  prisma: PrismaService,
  ownerId: number,
  label: string,
  recipients: string[],
): Promise<Fixture> => {
  const organizationSlug = `email-e2e-${runId}-${label}`
  const localPart = `e2e.${runId}.${label}`
  await prisma.organization.create({
    data: { slug: organizationSlug, ownerId },
  })
  const campaign = await prisma.campaign.create({
    data: {
      organizationSlug,
      userId: ownerId,
      slug: organizationSlug,
      isPro: true,
      details: { state: 'WY', zip: '82001' },
      data: {},
      aiContent: {},
    },
  })
  const sender = await prisma.outreachEmailSender.create({
    data: {
      organizationSlug,
      localPart,
      displayName: 'GoodParty E2E',
      forwardToEmail: FORWARD_TO,
    },
  })
  const outreachEmailId = nextSendId++
  const outreach = await prisma.outreach.create({
    data: {
      outreachType: OutreachType.email,
      status: OutreachStatus.in_progress,
      campaignId: campaign.id,
      organizationSlug,
      name: `Email E2E ${label}`,
      date: new Date(),
      email: {
        create: {
          id: outreachEmailId,
          senderId: sender.id,
          goal: 'Dev end-to-end run',
          layout: 'newsletter',
          theme: 'classic_blue',
          subject: 'Hi {{first_name}}, a dev end-to-end check',
          headline: 'Dev end-to-end check',
          body: 'This went to the SES mailbox simulator.',
          recipientCap: recipients.length,
          consentConfirmedAt: new Date(),
          consentConfirmedByUserId: ownerId,
        },
      },
    },
  })
  await prisma.outreachEmailRecipient.createMany({
    data: recipients.map((email, index) => ({
      outreachEmailId,
      senderId: sender.id,
      email,
      firstName: `E2e${index}`,
      lastName: 'Simulator',
    })),
  })
  await prisma.outreachPaymentHold.create({
    data: {
      outreachId: outreach.id,
      channel: OutreachType.email,
      state: OutreachHoldState.held,
      stripeCustomerId: `cus_email_e2e_${runId}`,
      paymentMethodId: 'pm_email_e2e',
      paymentIntentId: `pi_email_e2e_${runId}_${label}`,
      estimateCents: 0,
      authorizedCents: 0,
      captureBefore: addDays(new Date(), 4),
    },
  })
  return {
    organizationSlug,
    senderId: sender.id,
    localPart,
    outreachId: outreach.id,
    outreachEmailId,
  }
}

type Services = {
  prisma: PrismaService
  ses: SesService
  prepare: OutreachEmailPrepareService
  sweep: OutreachEmailSendSweepService
  lifecycle: OutreachEmailLifecycleService
  inbound: OutreachEmailInboundService
  sesClient: SESv2Client
  s3: S3Client
}

const prepare = async (services: Services, fixture: Fixture) => {
  await services.prepare.prepare(fixture.outreachEmailId)
  // A redelivered prepare message must change nothing.
  await services.prepare.prepare(fixture.outreachEmailId)
  const row = await services.prisma.outreachEmail.findUniqueOrThrow({
    where: { id: fixture.outreachEmailId },
    include: { sender: true },
  })
  if (row.sender.sesTenantName) tenantsCreated.add(row.sender.sesTenantName)
  return row
}

const statusCounts = async (
  prisma: PrismaService,
  outreachEmailId: number | number[],
) => {
  const groups = await prisma.outreachEmailRecipient.groupBy({
    by: ['status'],
    where: {
      outreachEmailId: Array.isArray(outreachEmailId)
        ? { in: outreachEmailId }
        : outreachEmailId,
    },
    _count: { _all: true },
  })
  const counts: Partial<Record<OutreachEmailRecipientStatus, number>> = {}
  for (const group of groups) counts[group.status] = group._count._all
  return counts
}

// Ticks like the cron: one tick a minute, until nothing is queued.
const sweepUntilDone = async (
  services: Services,
  outreachEmailIds: number[],
  onTick?: (tick: { startedAt: Date; endedAt: Date }) => Promise<void>,
) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const tickStartedAt = new Date()
    await services.sweep.runTick()
    const tickEndedAt = new Date()
    if (onTick) {
      await onTick({ startedAt: tickStartedAt, endedAt: tickEndedAt })
    }
    const queued = await services.prisma.outreachEmailRecipient.count({
      where: {
        outreachEmailId: { in: outreachEmailIds },
        status: {
          in: [
            OutreachEmailRecipientStatus.queued,
            OutreachEmailRecipientStatus.sending,
          ],
        },
      },
    })
    if (queued === 0) return
    const rest = CRON_PERIOD_MS - (Date.now() - tickStartedAt.getTime())
    if (rest > 0) await sleep(rest)
  }
  throw new Error('Recipients still queued after 30 ticks')
}

const waitForMetrics = async (
  services: Services,
  outreachEmailId: number,
  from: Date,
  done: (m: Awaited<ReturnType<SesService['getSendMetrics']>>) => boolean,
) => {
  const deadline = Date.now() + METRICS_WAIT_MS
  let metrics = await services.ses.getSendMetrics(
    outreachEmailId,
    from,
    new Date(),
  )
  while (!done(metrics) && Date.now() < deadline) {
    await sleep(POLL_MS)
    metrics = await services.ses.getSendMetrics(
      outreachEmailId,
      from,
      new Date(),
    )
    log(`metrics for send ${outreachEmailId}`, JSON.stringify(metrics))
  }
  return metrics
}

const templateExists = async (services: Services, templateName: string) => {
  try {
    await services.sesClient.send(
      new GetEmailTemplateCommand({ TemplateName: templateName }),
    )
    return true
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundException') {
      return false
    }
    throw error
  }
}

const streamToString = async (
  body: { transformToString: () => Promise<string> } | undefined,
) => (body ? body.transformToString() : '')

// The ooto simulator answers the From address, which SES inbound writes to
// the bucket. The deployed dev API gets the same SNS notification but has no
// sender for this local part, so only this process classifies it.
const findInboundFor = async (
  services: Services,
  bucket: string,
  localPart: string,
  since: Date,
): Promise<string | null> => {
  const seen = new Set<string>()
  const deadline = Date.now() + INBOUND_WAIT_MS
  while (Date.now() < deadline) {
    let token: string | undefined
    do {
      const page = await services.s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      )
      for (const object of page.Contents ?? []) {
        if (!object.Key || seen.has(object.Key)) continue
        // Slack for a laptop clock ahead of S3's.
        if (
          !object.LastModified ||
          object.LastModified < subMinutes(since, INBOUND_CLOCK_SLACK_MINUTES)
        ) {
          continue
        }
        seen.add(object.Key)
        const fetched = await services.s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
        )
        const raw = await streamToString(fetched.Body)
        if (
          raw.toLowerCase().includes(`${localPart}@${EMAIL_OUTREACH_DOMAIN}`)
        ) {
          return object.Key
        }
      }
      token = page.NextContinuationToken
    } while (token)
    await sleep(POLL_MS)
  }
  return null
}

const runPaths = async (services: Services, ownerId: number) => {
  const recipients = [
    ...simulator('success', 5),
    ...simulator('bounce', 2),
    ...simulator('complaint', 2),
    ...simulator('ooto', 1),
  ]
  const fixture = await createFixture(
    services.prisma,
    ownerId,
    'paths',
    recipients,
  )
  const prepared = await prepare(services, fixture)
  check('paths', 'prepare creates the tenant and template', true, {
    tenant: prepared.sender.sesTenantName,
    template: prepared.sesTemplateName,
    preparedAt: prepared.preparedAt,
  })

  const sentFrom = new Date()
  await sweepUntilDone(services, [fixture.outreachEmailId])
  const counts = await statusCounts(services.prisma, fixture.outreachEmailId)
  check(
    'paths',
    'SES accepts every simulator address through the tenant',
    counts.sent === recipients.length,
    counts,
  )
  const sample = await services.prisma.outreachEmailRecipient.findFirst({
    where: { outreachEmailId: fixture.outreachEmailId, status: 'sent' },
  })
  check(
    'paths',
    'each sent row has its SES message id',
    Boolean(sample?.sesMessageId),
    { sesMessageId: sample?.sesMessageId },
  )

  const metrics = await waitForMetrics(
    services,
    fixture.outreachEmailId,
    sentFrom,
    (m) => m.send >= recipients.length && m.bounce >= 2 && m.complaint >= 2,
  )
  check(
    'paths',
    'CloudWatch counts Send, Bounce and Complaint for this send',
    metrics.send === recipients.length &&
      metrics.bounce === 2 &&
      metrics.complaint === 2 &&
      metrics.renderingFailure === 0,
    metrics,
  )

  // finish waits out SES's lag itself only in the settle sweep; the metrics
  // above are already complete.
  await services.lifecycle.finish(fixture.outreachId)
  const finished = await services.prisma.outreach.findUniqueOrThrow({
    where: { id: fixture.outreachId },
    select: { status: true },
  })
  const sender = await services.prisma.outreachEmailSender.findUniqueOrThrow({
    where: { id: fixture.senderId },
  })
  check(
    'paths',
    'finish completes the send and holds warming back after bounces',
    finished.status === OutreachStatus.completed && sender.warmingStep === 0,
    { status: finished.status, warmingStep: sender.warmingStep },
  )
  if (prepared.sesTemplateName) {
    const exists = await templateExists(services, prepared.sesTemplateName)
    check('paths', 'finish deletes the SES template', !exists, {
      template: prepared.sesTemplateName,
      exists,
    })
  }

  const bucket = process.env.EMAIL_INBOUND_BUCKET ?? ''
  const key = await findInboundFor(
    services,
    bucket,
    fixture.localPart,
    sentFrom,
  )
  if (!key) {
    check(
      'paths',
      'the ooto auto-reply arrives through SES inbound',
      false,
      `nothing in ${bucket} for ${fixture.localPart} after ${INBOUND_WAIT_MS / 60_000} minutes (the receipt rule exists only after a prod deploy)`,
    )
    return
  }
  await services.inbound.process(bucket, key, false)
  const reply = await services.prisma.outreachEmailReply.findUnique({
    where: { rawObjectKey: key },
  })
  check(
    'paths',
    'the ooto auto-reply arrives and is dropped, not forwarded',
    reply?.classification === 'auto_reply',
    { key, classification: reply?.classification },
  )
}

const runAutoPause = async (
  services: Services,
  ownerId: number,
  kind: 'bounce' | 'complaint',
  reason: OutreachEmailPauseReason,
) => {
  const fixture = await createFixture(
    services.prisma,
    ownerId,
    `pause-${kind}`,
    simulator(kind, 1_000),
  )
  await prepare(services, fixture)
  services.sweep.clearCaches()

  const sentFrom = new Date()
  await services.sweep.runTick(PARTIAL_TICK_MS)
  const afterFirst = await statusCounts(
    services.prisma,
    fixture.outreachEmailId,
  )
  const sent = afterFirst.sent ?? 0
  log(`autopause ${kind}: first tick`, JSON.stringify(afterFirst))
  if (sent < 500 || (afterFirst.queued ?? 0) === 0) {
    check(
      'autopause',
      `${kind}: a partial tick passes the 500-send floor`,
      false,
      afterFirst,
    )
    return
  }

  const metrics = await waitForMetrics(
    services,
    fixture.outreachEmailId,
    sentFrom,
    (m) => m.send >= sent && m[kind] >= sent,
  )
  log(
    `autopause ${kind}: numbers before the next tick`,
    JSON.stringify(metrics),
  )

  // The sweep checks a running send at most every five minutes; clearing the
  // cache stands in for that wait.
  services.sweep.clearCaches()
  await services.sweep.runTick()
  const row = await services.prisma.outreachEmail.findUniqueOrThrow({
    where: { id: fixture.outreachEmailId },
  })
  const afterPause = await statusCounts(
    services.prisma,
    fixture.outreachEmailId,
  )
  check(
    'autopause',
    `${kind}: the next tick pauses with ${reason} and sends no more`,
    row.pauseReason === reason &&
      row.pausedAt !== null &&
      (afterPause.sent ?? 0) === sent,
    { pauseReason: row.pauseReason, before: afterFirst, after: afterPause },
  )

  await services.lifecycle.finish(fixture.outreachId)
  const finished = await services.prisma.outreach.findUniqueOrThrow({
    where: { id: fixture.outreachId },
    select: { status: true },
  })
  check(
    'autopause',
    `${kind}: a stopped send with recipients left ends canceled`,
    finished.status === OutreachStatus.canceled,
    { status: finished.status },
  )
}

const runPacing = async (services: Services, ownerId: number) => {
  const account = await services.ses.getAccount()
  log('GetAccount', JSON.stringify(account))
  const fixtures: Fixture[] = []
  for (const label of ['pace-a', 'pace-b', 'pace-c']) {
    fixtures.push(
      await createFixture(
        services.prisma,
        ownerId,
        label,
        simulator('success', 1_000),
      ),
    )
  }
  for (const fixture of fixtures) await prepare(services, fixture)
  services.sweep.clearCaches()

  const ids = fixtures.map((f) => f.outreachEmailId)
  const ticks: Array<{ seconds: number; sent: number; perSecond: number }> = []
  let sentBefore = 0
  await sweepUntilDone(services, ids, async ({ startedAt, endedAt }) => {
    const sentNow = await services.prisma.outreachEmailRecipient.count({
      where: { outreachEmailId: { in: ids }, status: 'sent' },
    })
    const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000
    const sent = sentNow - sentBefore
    sentBefore = sentNow
    ticks.push({
      seconds,
      sent,
      perSecond: Math.round((sent / Math.max(seconds, 1)) * 10) / 10,
    })
    log('pacing tick', JSON.stringify(ticks.at(-1)))
  })

  const counts = await statusCounts(services.prisma, ids)
  check(
    'pacing',
    'every recipient is sent, none failed or retried into failure',
    counts.sent === 3_000,
    counts,
  )
  // A full tick measures the pace; the last one may end early.
  const fullTicks = ticks.filter((t) => t.seconds >= 30)
  const limit = account.maxSendRate * 0.9
  check(
    'pacing',
    `full ticks stay at or under 90% of MaxSendRate (${limit}/s)`,
    fullTicks.length > 0 &&
      fullTicks.every((t) => t.sent / Math.max(t.seconds, 1) <= limit),
    { maxSendRate: account.maxSendRate, ticks },
  )
  const perSend = await Promise.all(
    ids.map((id) =>
      services.prisma.outreachEmailRecipient.aggregate({
        where: { outreachEmailId: id, status: 'sent' },
        _min: { sentAt: true },
      }),
    ),
  )
  const firstSends = perSend.map((a) => a._min.sentAt?.getTime() ?? 0)
  check(
    'pacing',
    'the sweep round-robins: every send starts in the first tick',
    firstSends.every(
      (t) => t > 0 && t - Math.min(...firstSends) < CRON_PERIOD_MS,
    ),
    { firstSentAt: firstSends.map((t) => new Date(t).toISOString()) },
  )
  for (const fixture of fixtures) {
    await services.lifecycle.finish(fixture.outreachId)
  }
}

const cleanUp = async (services: Services) => {
  if (flag('keep')) {
    log(`--keep: leaving tenants ${[...tenantsCreated].join(', ')}`)
    return
  }
  for (const tenantName of tenantsCreated) {
    try {
      await services.sesClient.send(
        new DeleteTenantCommand({ TenantName: tenantName }),
      )
      log(`DeleteTenant ${tenantName}: done`)
    } catch (error) {
      log(
        `DeleteTenant ${tenantName} failed`,
        error instanceof Error ? `${error.name}: ${error.message}` : '',
      )
    }
  }
}

const main = async () => {
  refuseUnlessSafe()
  const scenarios = selectedScenarios()
  const app: INestApplicationContext =
    await NestFactory.createApplicationContext(EmailDevE2eModule, {
      logger: ['error', 'warn'],
    })
  const services: Services = {
    prisma: app.get(PrismaService),
    ses: app.get(SesService),
    prepare: app.get(OutreachEmailPrepareService),
    sweep: app.get(OutreachEmailSendSweepService),
    lifecycle: app.get(OutreachEmailLifecycleService),
    inbound: app.get(OutreachEmailInboundService),
    sesClient: new SESv2Client({ region: SES_REGION }),
    s3: new S3Client({ region: SES_REGION }),
  }
  try {
    log(`run ${runId}: scenarios ${scenarios.join(', ')}`)
    const [migrated] = await services.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT to_regclass('email_sweep_lease') IS NOT NULL AS ok
    `
    if (!migrated?.ok) {
      throw new Error(
        'The local database has no email tables; run `npx prisma migrate deploy` first',
      )
    }
    if (flag('dry-run')) {
      log('--dry-run: boot and environment checks passed; nothing written')
      return
    }
    await services.prisma.$executeRaw`
      INSERT INTO email_sweep_lease (id) VALUES (1) ON CONFLICT DO NOTHING
    `
    const owner = await services.prisma.user.create({
      data: { email: `email-e2e-${runId}@goodparty.org` },
    })
    try {
      if (scenarios.includes('paths')) await runPaths(services, owner.id)
      if (scenarios.includes('autopause')) {
        await runAutoPause(
          services,
          owner.id,
          'bounce',
          OutreachEmailPauseReason.bounce_rate,
        )
        await runAutoPause(
          services,
          owner.id,
          'complaint',
          OutreachEmailPauseReason.complaint_rate,
        )
      }
      if (scenarios.includes('pacing')) await runPacing(services, owner.id)
    } finally {
      await cleanUp(services)
    }
  } finally {
    await app.close()
  }

  console.log('\n===== Paste everything below this line back =====')
  console.log(
    JSON.stringify(
      {
        runId,
        passed: checks.filter((c) => c.ok).length,
        failed: checks.filter((c) => !c.ok).length,
        checks,
      },
      null,
      2,
    ),
  )
  if (checks.some((c) => !c.ok)) process.exitCode = 1
}

main().catch((error: Error) => {
  console.error('FAILED', error.name, error.message, error.stack)
  process.exit(1)
})
