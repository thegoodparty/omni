import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { BulkEmailEntry, BulkEmailStatus } from '@aws-sdk/client-sesv2'
import {
  differenceInMilliseconds,
  differenceInSeconds,
  isAfter,
  max as latestOf,
  startOfMinute,
  subMinutes,
} from 'date-fns'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  APP_ROOT,
  VENDOR_CRONS_ENABLED,
} from '@/shared/util/appEnvironment.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  OutreachEmailPauseReason,
  OutreachEmailRecipientStatus,
  OutreachStatus,
} from '../../generated/prisma'
import {
  ACCOUNT_CACHE_SECONDS,
  AUTO_PAUSE_CHECK_MINUTES,
  AUTO_PAUSE_MAX_BOUNCE_RATE,
  AUTO_PAUSE_MAX_COMPLAINT_RATE,
  AUTO_PAUSE_MIN_SENDS,
  DAILY_QUOTA_HEADROOM,
  EMAIL_API_ROOT,
  EMAIL_OUTREACH_DOMAIN,
  SEND_BATCH_SIZE,
  SEND_LEASE_SECONDS,
  SEND_RATE_HEADROOM,
  SEND_TICK_BUDGET_MS,
  STUCK_SENDING_MINUTES,
} from '../emailOutreach.const'
import { EMAIL_VARIABLES } from '../templates/emailTemplate.const'
import {
  formatFrom,
  isBlockedByDevAllowlist,
} from '../util/renderOutreachEmail.util'
import {
  signUnsubscribeToken,
  unsubscribeSigningKey,
} from '../util/unsubscribeToken.util'
import { OutreachEmailPauseAlertService } from './outreachEmailPauseAlert.service'
import { OutreachEmailPrepareService } from './outreachEmailPrepare.service'
import { SesAccountState, SesBulkEntryResult, SesService } from './ses.service'

const SWEEP_JOB = 'emailSendSweep'

// Statuses SES gives one entry when the batch itself was fine but that
// address couldn't go yet. The row goes back to queued for a later tick.
const RETRYABLE_ENTRY_STATUSES = new Set<string>([
  BulkEmailStatus.ACCOUNT_THROTTLED,
  BulkEmailStatus.ACCOUNT_DAILY_QUOTA_EXCEEDED,
  BulkEmailStatus.ACCOUNT_SENDING_PAUSED,
  BulkEmailStatus.ACCOUNT_SUSPENDED,
  BulkEmailStatus.CONFIGURATION_SET_SENDING_PAUSED,
  BulkEmailStatus.TRANSIENT_FAILURE,
])

const ACCOUNT_PAUSE_REASONS: OutreachEmailPauseReason[] = [
  OutreachEmailPauseReason.ses_account,
  OutreachEmailPauseReason.daily_quota,
]

type ClaimedRecipient = {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
}

type ActiveSend = {
  id: number
  outreachId: number
  organizationSlug: string
  campaignId: number | null
  preparedAt: Date
  tenantName: string
  templateName: string
  from: string
  replyAddress: string
}

type BatchResult =
  | { kind: 'sent'; attempted: number }
  | { kind: 'empty' }
  | { kind: 'send_paused' }
  | { kind: 'end_tick' }

// Merge values go into SES's Handlebars template, which escapes them in the
// html part. Stripping the characters that matter keeps a name from becoming
// markup or a variable without double-escaping the text part.
const cleanName = (value: string | null): string =>
  (value ?? '').replace(/[<>{}]/g, '').trim()

@Injectable()
export class OutreachEmailSendSweepService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  private readonly holder = `${hostname()}-${randomUUID()}`
  private account: { state: SesAccountState; readAt: Date } | null = null
  private readonly lastChecked = new Map<number, Date>()
  private running = false

  constructor(
    private readonly ses: SesService,
    private readonly pauseAlert: OutreachEmailPauseAlertService,
    private readonly prepare: OutreachEmailPrepareService,
  ) {
    super()
  }

  // The account read and auto-pause check times are per process; a test
  // clears them between cases.
  clearCaches(): void {
    this.account = null
    this.lastChecked.clear()
  }

  // Pacing waits through this, so a test can run a tick without real time.
  sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))

  // No CronLockService: the lease row is the single runner across replicas,
  // and a tick outlives a minute claim's 30-second stale window.
  @Cron('* * * * *', { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweep(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return
    await this.runTick()
  }

  async runTick(budgetMs: number = SEND_TICK_BUDGET_MS): Promise<void> {
    // The scheduler doesn't wait for a run to finish, and the lease lets its
    // own holder back in, so a tick that overran would otherwise run beside
    // the next one and double the send rate.
    if (this.running) return
    this.running = true
    try {
      const startedAt = new Date()
      if (!(await this.hasWork())) return
      if (!(await this.takeLease())) return
      try {
        await this.tick(startedAt, budgetMs)
      } finally {
        await this.releaseLease()
      }
    } finally {
      this.running = false
    }
  }

  async takeLease(): Promise<boolean> {
    const taken = await this.client.$executeRaw`
      UPDATE email_sweep_lease
      SET holder = ${this.holder},
          expires_at = now() + make_interval(secs => ${SEND_LEASE_SECONDS}::int)
      WHERE id = 1
        AND (expires_at IS NULL OR expires_at < now() OR holder = ${this.holder})
    `
    return taken === 1
  }

  private async renewLease(): Promise<boolean> {
    const renewed = await this.client.$executeRaw`
      UPDATE email_sweep_lease
      SET expires_at = now() + make_interval(secs => ${SEND_LEASE_SECONDS}::int)
      WHERE id = 1 AND holder = ${this.holder}
    `
    return renewed === 1
  }

  private async releaseLease(): Promise<void> {
    await this.client.$executeRaw`
      UPDATE email_sweep_lease SET expires_at = now()
      WHERE id = 1 AND holder = ${this.holder}
    `
  }

  // Checked before taking the lease, so an idle minute writes nothing.
  // Account-paused sends count as work, since the tick is what resumes them.
  private async hasWork(): Promise<boolean> {
    const found = await this.client.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM outreach_email_recipient r
        JOIN outreach_email e ON e.id = r.outreach_email_id
        JOIN outreach o ON o.id = e.outreach_id
        WHERE r.status = 'queued'
          AND o.status = 'in_progress'
          AND e.prepared_at IS NOT NULL
          AND e.stopping_at IS NULL
          AND (
            e.paused_at IS NULL
            OR e.pause_reason IN ('ses_account', 'daily_quota')
          )
      ) OR EXISTS (
        SELECT 1 FROM outreach_email_recipient
        WHERE status = 'sending'
          AND claimed_at < now() - make_interval(mins => ${STUCK_SENDING_MINUTES}::int)
      ) AS found
    `
    return found[0]?.found === true
  }

  private async tick(startedAt: Date, budgetMs: number): Promise<void> {
    const outOfTime = () =>
      differenceInMilliseconds(new Date(), startedAt) >= budgetMs

    // A claim this old belongs to a runner that died mid-batch. SES may have
    // accepted it, which is the named duplicate-send exposure.
    await this.client.outreachEmailRecipient.updateMany({
      where: {
        status: OutreachEmailRecipientStatus.sending,
        claimedAt: { lt: subMinutes(new Date(), STUCK_SENDING_MINUTES) },
      },
      data: { status: OutreachEmailRecipientStatus.queued, claimedAt: null },
    })

    const signingKey = unsubscribeSigningKey()
    if (!signingKey) {
      this.logger.error(
        'EMAIL_UNSUBSCRIBE_SIGNING_KEY is not set; email sends are waiting',
      )
      return
    }

    let account: SesAccountState
    try {
      account = await this.readAccount()
    } catch (err) {
      this.logger.error({ err }, 'Reading the SES account failed')
      return
    }
    if (!account.sendingEnabled) {
      this.logger.error('CRITICAL SES reports sending disabled for the account')
      await this.pauseActive(OutreachEmailPauseReason.ses_account)
      return
    }
    if (
      account.sentLast24Hours >=
      account.max24HourSend * DAILY_QUOTA_HEADROOM
    ) {
      await this.pauseActive(OutreachEmailPauseReason.daily_quota)
      return
    }
    await this.model.updateMany({
      where: { pauseReason: { in: ACCOUNT_PAUSE_REASONS } },
      data: { pausedAt: null, pauseReason: null },
    })

    let active = await this.listActive()
    for (const send of active) {
      await this.checkAutoPause(send)
    }
    active = await this.listActive()
    for (const send of active) {
      await this.dropUnsubscribed(send)
    }

    const perSecond = Math.max(1, account.maxSendRate * SEND_RATE_HEADROOM)
    while (active.length > 0 && !outOfTime()) {
      const stillActive: ActiveSend[] = []
      for (const send of active) {
        if (outOfTime()) return
        const batchStartedAt = new Date()
        const result = await this.sendBatch(send, signingKey)
        if (result.kind === 'end_tick') return
        if (result.kind === 'sent') {
          stillActive.push(send)
          if (!(await this.renewLease())) {
            this.logger.warn('Lost the email sweep lease mid-tick')
            return
          }
          const minimumMs = (result.attempted / perSecond) * 1000
          const waitMs = Math.min(
            minimumMs - differenceInMilliseconds(new Date(), batchStartedAt),
            budgetMs - differenceInMilliseconds(new Date(), startedAt),
          )
          if (waitMs > 0) await this.sleep(waitMs)
        }
      }
      active = stillActive
    }
  }

  private async readAccount(): Promise<SesAccountState> {
    if (
      this.account &&
      differenceInSeconds(new Date(), this.account.readAt) <
        ACCOUNT_CACHE_SECONDS
    ) {
      return this.account.state
    }
    const state = await this.ses.getAccount()
    this.account = { state, readAt: new Date() }
    return state
  }

  private async listActive(): Promise<ActiveSend[]> {
    const rows = await this.model.findMany({
      where: {
        preparedAt: { not: null },
        stoppingAt: null,
        pausedAt: null,
        outreach: { status: OutreachStatus.in_progress },
      },
      include: {
        sender: true,
        outreach: { select: { organizationSlug: true, campaignId: true } },
      },
      orderBy: { id: 'asc' },
    })
    const active: ActiveSend[] = []
    for (const row of rows) {
      const tenantName = row.sender.sesTenantName
      if (!tenantName || !row.sesTemplateName || !row.preparedAt) {
        this.logger.error(
          { outreachEmailId: row.id },
          'A prepared email send has no tenant or template',
        )
        continue
      }
      const address = `${row.sender.localPart}@${EMAIL_OUTREACH_DOMAIN}`
      active.push({
        id: row.id,
        outreachId: row.outreachId,
        organizationSlug:
          row.outreach.organizationSlug ?? row.sender.organizationSlug,
        campaignId: row.outreach.campaignId,
        preparedAt: row.preparedAt,
        tenantName,
        templateName: row.sesTemplateName,
        from: formatFrom(row.sender.displayName, address),
        replyAddress: address,
      })
    }
    return active
  }

  // The send row is share-locked for the claim, so a settle that sets
  // stopping_at waits for it and then sees these rows as sending; one that
  // got there first makes this claim nothing.
  private async claim(outreachEmailId: number): Promise<ClaimedRecipient[]> {
    return this.client.$queryRaw<ClaimedRecipient[]>`
      WITH send_row AS (
        SELECT id FROM outreach_email
        WHERE id = ${outreachEmailId}
          AND stopping_at IS NULL
          AND paused_at IS NULL
        FOR SHARE
      )
      UPDATE outreach_email_recipient
      SET status = 'sending', claimed_at = now()
      WHERE id IN (
        SELECT r.id FROM outreach_email_recipient r
        JOIN send_row ON send_row.id = r.outreach_email_id
        WHERE r.status = 'queued'
        ORDER BY r.id
        LIMIT ${SEND_BATCH_SIZE}
        FOR UPDATE OF r SKIP LOCKED
      )
      RETURNING id, email, first_name, last_name
    `
  }

  // Exposed for the concurrency test, which runs many claims at once.
  async claimBatch(outreachEmailId: number): Promise<number[]> {
    return (await this.claim(outreachEmailId)).map(({ id }) => id)
  }

  private async sendBatch(
    send: ActiveSend,
    signingKey: string,
  ): Promise<BatchResult> {
    const claimed = await this.claim(send.id)
    if (claimed.length === 0) return { kind: 'empty' }

    const blocked = claimed.filter((r) => isBlockedByDevAllowlist(r.email))
    const recipients = claimed.filter((r) => !isBlockedByDevAllowlist(r.email))
    if (blocked.length > 0) {
      await this.setStatus(
        blocked.map(({ id }) => id),
        OutreachEmailRecipientStatus.failed,
      )
    }
    if (recipients.length === 0) return { kind: 'sent', attempted: 0 }

    const issuedAt = Math.floor(Date.now() / 1000)
    const entries: BulkEmailEntry[] = recipients.map((recipient) => {
      const token = signUnsubscribeToken(signingKey, {
        email: recipient.email,
        organizationSlug: send.organizationSlug,
        outreachEmailId: send.id,
        issuedAt,
      })
      const oneClick = `${EMAIL_API_ROOT}/v1/email/unsubscribe/one-click?t=${token}`
      return {
        Destination: { ToAddresses: [recipient.email] },
        ReplacementEmailContent: {
          ReplacementTemplate: {
            ReplacementTemplateData: JSON.stringify({
              [EMAIL_VARIABLES.firstName]: cleanName(recipient.first_name),
              [EMAIL_VARIABLES.lastName]: cleanName(recipient.last_name),
              [EMAIL_VARIABLES.unsubscribeUrl]: `${APP_ROOT}/email/unsubscribe/${token}`,
            }),
          },
        },
        ReplacementHeaders: [
          {
            Name: 'List-Unsubscribe',
            Value: `<${oneClick}>, <mailto:${send.replyAddress}?subject=unsubscribe>`,
          },
          {
            Name: 'List-Unsubscribe-Post',
            Value: 'List-Unsubscribe=One-Click',
          },
        ],
      }
    })
    const ids = recipients.map(({ id }) => id)

    const outcome = await this.ses.sendBulk({
      from: send.from,
      tenantName: send.tenantName,
      templateName: send.templateName,
      outreachEmailId: send.id,
      entries,
    })

    switch (outcome.kind) {
      case 'sent':
        return this.recordResults(send, ids, outcome.results)
      case 'throttled':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        return { kind: 'end_tick' }
      case 'quota':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        await this.pauseActive(OutreachEmailPauseReason.daily_quota)
        return { kind: 'end_tick' }
      case 'account_paused':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        this.logger.error(
          { message: outcome.message },
          'CRITICAL SES refused a send because the account is paused',
        )
        await this.pauseActive(OutreachEmailPauseReason.ses_account)
        return { kind: 'end_tick' }
      case 'tenant_paused':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        await this.pause(send, OutreachEmailPauseReason.ses_tenant, {
          message: outcome.message,
        })
        return { kind: 'send_paused' }
      case 'rejected':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        this.logger.error(
          { outreachEmailId: send.id, message: outcome.message },
          'CRITICAL SES rejected an email batch',
        )
        await this.pause(send, OutreachEmailPauseReason.manual, {
          message: outcome.message,
        })
        return { kind: 'send_paused' }
      case 'error':
        await this.setStatus(ids, OutreachEmailRecipientStatus.queued)
        this.logger.error(
          { err: outcome.err, outreachEmailId: send.id },
          'SendBulkEmail failed; the batch goes back to queued',
        )
        return { kind: 'end_tick' }
    }
  }

  private async recordResults(
    send: ActiveSend,
    ids: number[],
    results: SesBulkEntryResult[],
  ): Promise<BatchResult> {
    const sent: { id: number; messageId: string }[] = []
    const retry: number[] = []
    const failed: number[] = []
    ids.forEach((id, index) => {
      const result = results[index]
      if (result?.status === BulkEmailStatus.SUCCESS && result.messageId) {
        sent.push({ id, messageId: result.messageId })
      } else if (
        !result?.status ||
        RETRYABLE_ENTRY_STATUSES.has(result.status)
      ) {
        retry.push(id)
      } else {
        failed.push(id)
      }
    })
    if (failed.length > 0) {
      this.logger.warn(
        {
          outreachEmailId: send.id,
          failed: failed.length,
          errors: results
            .filter((r) => r.status !== BulkEmailStatus.SUCCESS)
            .slice(0, 5),
        },
        'SES refused some recipients',
      )
    }

    await this.client.$transaction(async (tx) => {
      if (sent.length > 0) {
        const marked = await tx.$executeRaw`
          UPDATE outreach_email_recipient AS r
          SET status = 'sent', ses_message_id = v.message_id,
              sent_at = now(), claimed_at = NULL
          FROM unnest(
            ${sent.map((s) => s.id)}::int[],
            ${sent.map((s) => s.messageId)}::text[]
          ) AS v(id, message_id)
          WHERE r.id = v.id AND r.status = 'sending'
        `
        await tx.outreachEmail.update({
          where: { id: send.id },
          data: { sentCount: { increment: marked } },
        })
      }
      if (failed.length > 0) {
        await tx.outreachEmailRecipient.updateMany({
          where: {
            id: { in: failed },
            status: OutreachEmailRecipientStatus.sending,
          },
          data: {
            status: OutreachEmailRecipientStatus.failed,
            claimedAt: null,
          },
        })
      }
      if (retry.length > 0) {
        await tx.outreachEmailRecipient.updateMany({
          where: {
            id: { in: retry },
            status: OutreachEmailRecipientStatus.sending,
          },
          data: {
            status: OutreachEmailRecipientStatus.queued,
            claimedAt: null,
          },
        })
      }
    })

    const statuses = new Set(results.map((r) => r.status))
    if (statuses.has(BulkEmailStatus.ACCOUNT_DAILY_QUOTA_EXCEEDED)) {
      await this.pauseActive(OutreachEmailPauseReason.daily_quota)
      return { kind: 'end_tick' }
    }
    if (
      statuses.has(BulkEmailStatus.ACCOUNT_SENDING_PAUSED) ||
      statuses.has(BulkEmailStatus.ACCOUNT_SUSPENDED)
    ) {
      await this.pauseActive(OutreachEmailPauseReason.ses_account)
      return { kind: 'end_tick' }
    }
    if (retry.length > 0) return { kind: 'end_tick' }
    return { kind: 'sent', attempted: ids.length }
  }

  // Prepare drops unsubscribes once. Someone who unsubscribes while a send
  // runs, or while it sits paused, must not get the rest of it. Only
  // suppressions written since prepare can match, so the join starts there
  // rather than probing every queued row each tick.
  private async dropUnsubscribed(send: ActiveSend): Promise<void> {
    const slugs = await this.prepare.suppressionSlugsFor(
      send.organizationSlug,
      send.campaignId,
    )
    await this.client.$executeRaw`
      DELETE FROM outreach_email_recipient r
      USING outreach_email_suppression s
      WHERE s.organization_slug = ANY(${slugs})
        AND s.revoked_at IS NULL
        AND s.updated_at >= ${send.preparedAt}
        AND r.outreach_email_id = ${send.id}
        AND r.email = s.email
        AND r.status = 'queued'
    `
  }

  // Reads SES's numbers for the send since the later of its first email and
  // its last staff resume, at most every few minutes. If CloudWatch can't be
  // read the send keeps going; SES's own tenant pause is the backstop.
  async checkAutoPause(send: Pick<ActiveSend, 'id' | 'outreachId'>) {
    const last = this.lastChecked.get(send.id)
    if (
      last &&
      isAfter(last, subMinutes(new Date(), AUTO_PAUSE_CHECK_MINUTES))
    ) {
      return
    }
    const row = await this.model.findUniqueOrThrow({
      where: { id: send.id },
      select: { resumedAt: true },
    })
    const first = await this.client.outreachEmailRecipient.aggregate({
      where: { outreachEmailId: send.id, sentAt: { not: null } },
      _min: { sentAt: true },
    })
    const firstSentAt = first._min.sentAt
    if (!firstSentAt) return
    this.lastChecked.set(send.id, new Date())

    const windowStart = startOfMinute(
      row.resumedAt ? latestOf([firstSentAt, row.resumedAt]) : firstSentAt,
    )
    let metrics: Awaited<ReturnType<SesService['getSendMetrics']>>
    try {
      metrics = await this.ses.getSendMetrics(send.id, windowStart, new Date())
    } catch (err) {
      this.logger.warn(
        { err, outreachEmailId: send.id },
        'Reading SES metrics failed; the send continues',
      )
      return
    }

    if (metrics.renderingFailure > 0) {
      this.logger.error(
        { outreachEmailId: send.id, metrics },
        'CRITICAL SES failed to render an email send; its template is broken',
      )
      await this.pause(send, OutreachEmailPauseReason.manual, { metrics })
      return
    }
    if (metrics.send < AUTO_PAUSE_MIN_SENDS) return
    if (metrics.bounce / metrics.send > AUTO_PAUSE_MAX_BOUNCE_RATE) {
      await this.pause(send, OutreachEmailPauseReason.bounce_rate, { metrics })
    } else if (
      metrics.complaint / metrics.send >
      AUTO_PAUSE_MAX_COMPLAINT_RATE
    ) {
      await this.pause(send, OutreachEmailPauseReason.complaint_rate, {
        metrics,
      })
    }
  }

  private async pause(
    send: Pick<ActiveSend, 'id' | 'outreachId'>,
    reason: OutreachEmailPauseReason,
    detail: object,
  ): Promise<void> {
    const paused = await this.model.updateMany({
      where: { id: send.id, pausedAt: null },
      data: { pausedAt: new Date(), pauseReason: reason },
    })
    if (paused.count === 1) {
      this.logger.warn(
        {
          outreachEmailId: send.id,
          outreachId: send.outreachId,
          reason,
          ...detail,
        },
        'Email send paused',
      )
      // Not awaited: notify never throws, and Slack must not slow the tick.
      void this.pauseAlert.notify(send.id, reason)
    }
  }

  private async pauseActive(reason: OutreachEmailPauseReason): Promise<void> {
    // The cached account read predates this refusal; reusing it would clear
    // the pause on the next tick.
    this.account = null
    const paused = await this.model.updateMany({
      where: {
        pausedAt: null,
        stoppingAt: null,
        preparedAt: { not: null },
        outreach: { status: OutreachStatus.in_progress },
      },
      data: { pausedAt: new Date(), pauseReason: reason },
    })
    if (paused.count > 0) {
      this.logger.warn(
        { reason, sends: paused.count },
        'Email sends paused for the SES account',
      )
    }
  }

  private async setStatus(
    ids: number[],
    status: OutreachEmailRecipientStatus,
  ): Promise<void> {
    await this.client.outreachEmailRecipient.updateMany({
      where: { id: { in: ids }, status: OutreachEmailRecipientStatus.sending },
      data: { status, claimedAt: null },
    })
  }
}
