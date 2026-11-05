import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  addHours,
  differenceInMilliseconds,
  isAfter,
  parseISO,
  startOfHour,
  subDays,
  subHours,
} from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { resolveEnvVar } from '@/shared/env/env'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OutreachEmailRecipientStatus } from '../../generated/prisma'
import { parseEventFile, SesEvent, SesEventType } from '../util/sesEvent.util'

const EVENTS_JOB = 'emailEventSweep'
const EVENTS_PREFIX = 'events/'
// Firehose names a file for the hour its oldest record arrived, and a retried
// delivery can land well after newer files, so each run re-lists this many
// hours before the newest file it has already applied.
const LOOKBACK_HOURS = 6
// The ten-minute claim goes stale after 5 minutes, so a run stops starting
// files well before that.
const RUN_BUDGET_MS = 3 * 60 * 1000
// Matches the bucket's 90-day expiry: a marker for a file that no longer
// exists can never be needed again.
const MARKER_RETENTION_DAYS = 90
const LOOKUP_CHUNK = 5000

const { Delivery, Bounce, Complaint, Open, Click } = SesEventType
const { sent, delivered, bounced } = OutreachEmailRecipientStatus

// Status only moves forward: sent, then delivered, then bounced, then
// complained. An event that arrives late never moves a row back.
const STATUS_TRANSITIONS: Partial<
  Record<
    SesEventType,
    {
      to: OutreachEmailRecipientStatus
      from: OutreachEmailRecipientStatus[]
    }
  >
> = {
  [Delivery]: { to: delivered, from: [sent] },
  [Bounce]: { to: bounced, from: [sent, delivered] },
  [Complaint]: {
    to: OutreachEmailRecipientStatus.complained,
    from: [sent, delivered, bounced],
  },
}

const TIMESTAMP_FIELDS = {
  [Delivery]: 'deliveredAt',
  [Bounce]: 'bouncedAt',
  [Complaint]: 'complainedAt',
  [Open]: 'firstOpenedAt',
  [Click]: 'firstClickedAt',
} as const

const hourPrefix = (hour: Date) =>
  `${EVENTS_PREFIX}${formatInTimeZone(hour, 'UTC', 'yyyy/MM/dd/HH')}/`

const hourOfKey = (key: string): Date | null => {
  const match = /^events\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\//.exec(key)
  return match
    ? parseISO(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z`)
    : null
}

// Reads the files SES's Firehose destination writes to SES_EVENTS_BUCKET and
// records each recipient's delivery, bounce, complaint, first open and first
// click. Per-email events never go through the shared queue.
@Injectable()
export class OutreachEmailEventsService extends createPrismaBase(
  MODELS.OutreachEmailEventFile,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  @Cron('3-59/10 * * * *', { name: EVENTS_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepEvents(): Promise<void> {
    // Set by Pulumi on dev and prod only. Previews and local send through the
    // SES mock and have no events to read.
    if (!resolveEnvVar('SES_EVENTS_BUCKET').configured) return
    const now = new Date()
    if (!(await this.cronLock.tryClaimTenMinuteRun(EVENTS_JOB, now))) return
    try {
      await this.runEventSweep()
    } finally {
      await this.cronLock.markTenMinuteCompleted(EVENTS_JOB, now)
    }
  }

  async runEventSweep(): Promise<void> {
    const bucket = resolveEnvVar('SES_EVENTS_BUCKET')
    if (!bucket.configured) return
    const startedAt = new Date()

    const pending = await this.pendingKeys(bucket.value, startedAt)
    for (const key of pending) {
      if (differenceInMilliseconds(new Date(), startedAt) > RUN_BUDGET_MS) {
        this.logger.info(
          { remaining: pending.length - pending.indexOf(key) },
          'SES event sweep hit its time budget; the next run continues',
        )
        break
      }
      try {
        await this.applyFile(bucket.value, key)
      } catch (err) {
        this.logger.error(
          { err, key },
          'Applying an SES event file failed; the next run retries it',
        )
      }
    }

    await this.model.deleteMany({
      where: {
        processedAt: { lt: subDays(startedAt, MARKER_RETENTION_DAYS) },
      },
    })
  }

  // Keys sort by the time Firehose wrote them, so files are applied oldest
  // first. Without any marker yet, the whole prefix is listed once.
  private async pendingKeys(bucket: string, now: Date): Promise<string[]> {
    const newest = await this.model.findFirst({
      orderBy: { key: 'desc' },
      select: { key: true },
    })
    const newestHour = newest ? hourOfKey(newest.key) : null

    const listed: string[] = []
    if (!newestHour) {
      listed.push(...(await this.s3.listKeys(bucket, EVENTS_PREFIX)))
    } else {
      const lastHour = startOfHour(now)
      for (
        let hour = subHours(newestHour, LOOKBACK_HOURS);
        !isAfter(hour, lastHour);
        hour = addHours(hour, 1)
      ) {
        listed.push(...(await this.s3.listKeys(bucket, hourPrefix(hour))))
      }
    }
    if (listed.length === 0) return []

    const done = await this.model.findMany({
      where: { key: { in: listed } },
      select: { key: true },
    })
    const doneKeys = new Set(done.map((row) => row.key))
    return listed.filter((key) => !doneKeys.has(key)).sort()
  }

  // Every write is a compare-and-set that only moves a row forward, so
  // applying a file twice, or files out of order, leaves the same result. The
  // marker is written last: a run that dies partway re-applies the file.
  private async applyFile(bucket: string, key: string): Promise<void> {
    const bytes = await this.s3.getFileBytes(bucket, key)
    if (!bytes) {
      this.logger.warn({ key }, 'SES event file vanished before it was read')
      return
    }
    const { events, skipped } = parseEventFile(bytes)
    if (skipped > 0) {
      this.logger.warn({ key, skipped }, 'Skipped unreadable SES event records')
    }

    const earliest = new Map<string, SesEvent>()
    for (const event of events) {
      const id = `${event.type}:${event.messageId}`
      const seen = earliest.get(id)
      if (!seen || isAfter(seen.timestamp, event.timestamp)) {
        earliest.set(id, event)
      }
    }

    const recipients = await this.recipientIds([
      ...new Set(events.map((event) => event.messageId)),
    ])
    for (const event of earliest.values()) {
      const recipientId = recipients.get(event.messageId)
      if (recipientId === undefined) {
        this.logger.debug(
          { messageId: event.messageId, type: event.type },
          'SES event for an unknown message; skipped',
        )
        continue
      }
      await this.applyEvent(recipientId, event)
    }

    await this.model.create({
      data: { key, eventCount: events.length },
    })
  }

  private async recipientIds(
    messageIds: string[],
  ): Promise<Map<string, number>> {
    const ids = new Map<string, number>()
    for (let i = 0; i < messageIds.length; i += LOOKUP_CHUNK) {
      const rows = await this.client.outreachEmailRecipient.findMany({
        where: { sesMessageId: { in: messageIds.slice(i, i + LOOKUP_CHUNK) } },
        select: { id: true, sesMessageId: true },
      })
      for (const row of rows) {
        if (row.sesMessageId) ids.set(row.sesMessageId, row.id)
      }
    }
    return ids
  }

  private async applyEvent(recipientId: number, event: SesEvent) {
    const field = TIMESTAMP_FIELDS[event.type]
    await this.client.outreachEmailRecipient.updateMany({
      where: {
        id: recipientId,
        OR: [{ [field]: null }, { [field]: { gt: event.timestamp } }],
      },
      data: {
        [field]: event.timestamp,
        ...(event.bounceType ? { bounceType: event.bounceType } : {}),
      },
    })

    const transition = STATUS_TRANSITIONS[event.type]
    if (transition) {
      await this.client.outreachEmailRecipient.updateMany({
        where: { id: recipientId, status: { in: transition.from } },
        data: { status: transition.to },
      })
    }
  }
}
