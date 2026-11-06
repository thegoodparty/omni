import { gzipSync } from 'node:zlib'
import { addMinutes, subHours, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { OutreachEmailRecipientStatus } from '../../generated/prisma'
import { OutreachEmailEventsService } from '../services/outreachEmailEvents.service'
import { parseEventFile, SesEventType } from '../util/sesEvent.util'
import { createEmailOrgs, createSend, createSender } from './emailSendFixtures'

const service = useTestService()

const BUCKET = 'goodparty-ses-events-test'
const bucket = new Map<string, Buffer>()
let fileCount = 0
let pat: string
let sam: string

type EventType = `${SesEventType}` | 'Send'

const record = (eventType: EventType, messageId: string, at: Date) => {
  const timestamp = at.toISOString()
  const detail = { timestamp }
  return {
    eventType,
    mail: { timestamp, messageId, destination: ['pat@example.com'] },
    ...(eventType === 'Delivery' ? { delivery: detail } : {}),
    ...(eventType === 'Bounce'
      ? { bounce: { ...detail, bounceType: 'Permanent' } }
      : {}),
    ...(eventType === 'Complaint' ? { complaint: detail } : {}),
    ...(eventType === 'Open' ? { open: detail } : {}),
    ...(eventType === 'Click'
      ? { click: { ...detail, link: 'https://example.com/{"a":"}"}' } }
      : {}),
    ...(eventType === 'Send' ? { send: {} } : {}),
  }
}

const fileBody = (records: object[]) =>
  gzipSync(Buffer.from(records.map((r) => JSON.stringify(r)).join('')))

const putFile = (records: object[], hour = new Date()) => {
  fileCount++
  const stamp = formatInTimeZone(hour, 'UTC', 'yyyy/MM/dd/HH')
  const name = formatInTimeZone(hour, 'UTC', 'yyyy-MM-dd-HH-mm-ss')
  const key = `events/${stamp}/ses-events-test-1-${name}-${String(
    fileCount,
  ).padStart(4, '0')}.gz`
  bucket.set(key, fileBody(records))
  return key
}

const sweep = () => service.app.get(OutreachEmailEventsService).runEventSweep()

const recipient = (messageId: string) =>
  service.prisma.outreachEmailRecipient.findUniqueOrThrow({
    where: { sesMessageId: messageId },
  })

const listKeys = vi.fn((_: string, prefix: string) =>
  Promise.resolve([...bucket.keys()].filter((key) => key.startsWith(prefix))),
)
const getFileBytes = vi.fn((_: string, key: string) =>
  Promise.resolve(bucket.get(key)),
)

beforeEach(async () => {
  bucket.clear()
  vi.stubEnv('SES_EVENTS_BUCKET', BUCKET)
  vi.spyOn(service.app.get(S3Service), 'listKeys').mockImplementation(listKeys)
  vi.spyOn(service.app.get(S3Service), 'getFileBytes').mockImplementation(
    getFileBytes,
  )

  const orgs = await createEmailOrgs(service.prisma, service.user.id)
  const sender = await createSender(service.prisma, orgs.winSlug)
  const { outreachEmailId } = await createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: ['pat@example.com', 'sam@example.com'],
  })
  const rows = await service.prisma.outreachEmailRecipient.findMany({
    where: { outreachEmailId },
    orderBy: { id: 'asc' },
  })
  const messageIds = rows.map((row) => `ses-${row.id}-${Math.random()}`)
  await Promise.all(
    rows.map((row, i) =>
      service.prisma.outreachEmailRecipient.update({
        where: { id: row.id },
        data: {
          status: OutreachEmailRecipientStatus.sent,
          sentAt: new Date(),
          sesMessageId: messageIds[i],
        },
      }),
    ),
  )
  const [first, second] = messageIds
  if (!first || !second) throw new Error('fixture send has no recipients')
  pat = first
  sam = second
})

describe('parsing an event file', () => {
  it('reads records written back to back, gzipped or not', () => {
    const at = new Date('2026-11-04T19:01:02.123Z')
    const records = [record('Delivery', 'm-1', at), record('Open', 'm-1', at)]
    const plain = Buffer.from(records.map((r) => JSON.stringify(r)).join('\n'))

    for (const bytes of [fileBody(records), plain]) {
      expect(parseEventFile(bytes)).toEqual({
        events: [
          { type: SesEventType.Delivery, messageId: 'm-1', timestamp: at },
          { type: SesEventType.Open, messageId: 'm-1', timestamp: at },
        ],
        skipped: 0,
      })
    }
  })

  it('keeps braces inside strings from splitting a record', () => {
    const at = new Date()
    const { events } = parseEventFile(fileBody([record('Click', 'm-2', at)]))
    expect(events).toEqual([
      { type: SesEventType.Click, messageId: 'm-2', timestamp: at },
    ])
  })

  it('skips event types it does not track and records it cannot read', () => {
    const bytes = Buffer.from(
      JSON.stringify(record('Send', 'm-3', new Date())) +
        '{"eventType":"Delivery","mail":{}}',
    )
    expect(parseEventFile(bytes)).toEqual({ events: [], skipped: 2 })
  })
})

describe('the event sweep', () => {
  it('records a delivery and moves the recipient from sent to delivered', async () => {
    const at = subMinutes(new Date(), 3)
    putFile([record('Delivery', pat, at)])

    await sweep()

    expect(await recipient(pat)).toMatchObject({
      status: OutreachEmailRecipientStatus.delivered,
      deliveredAt: at,
    })
  })

  it('never moves a bounced or complained recipient back to delivered', async () => {
    const at = subMinutes(new Date(), 10)
    putFile([record('Bounce', pat, at), record('Complaint', sam, at)])
    await sweep()
    putFile([
      record('Delivery', pat, subMinutes(at, 1)),
      record('Delivery', sam, subMinutes(at, 1)),
      record('Bounce', sam, at),
    ])
    await sweep()

    expect(await recipient(pat)).toMatchObject({
      status: OutreachEmailRecipientStatus.bounced,
      bouncedAt: at,
      bounceType: 'Permanent',
      deliveredAt: subMinutes(at, 1),
    })
    expect(await recipient(sam)).toMatchObject({
      status: OutreachEmailRecipientStatus.complained,
      complainedAt: at,
      bouncedAt: at,
    })
  })

  it('moves a delivered recipient forward to complained', async () => {
    const at = subMinutes(new Date(), 10)
    putFile([record('Delivery', pat, at)])
    putFile([record('Complaint', pat, addMinutes(at, 5))])

    await sweep()

    expect((await recipient(pat)).status).toBe(
      OutreachEmailRecipientStatus.complained,
    )
  })

  it('keeps the earliest open and click, whatever order the files arrive in', async () => {
    const first = subMinutes(new Date(), 30)
    putFile([
      record('Open', pat, addMinutes(first, 10)),
      record('Open', pat, addMinutes(first, 2)),
      record('Click', pat, addMinutes(first, 12)),
    ])
    await sweep()
    putFile([record('Open', pat, first), record('Click', pat, first)])
    await sweep()
    putFile([record('Open', pat, addMinutes(first, 20))])
    await sweep()

    expect(await recipient(pat)).toMatchObject({
      firstOpenedAt: first,
      firstClickedAt: first,
      status: OutreachEmailRecipientStatus.sent,
    })
  })

  it('applies each file once across runs', async () => {
    const key = putFile([record('Delivery', pat, new Date())])

    await sweep()
    await sweep()

    expect(getFileBytes).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.outreachEmailEventFile.findUnique({
        where: { key },
      }),
    ).toMatchObject({ eventCount: 1 })
  })

  it('leaves the same result when a file is applied again', async () => {
    const at = subMinutes(new Date(), 5)
    const key = putFile([record('Delivery', pat, at), record('Open', pat, at)])
    await sweep()
    const before = await recipient(pat)

    await service.prisma.outreachEmailEventFile.delete({ where: { key } })
    await sweep()

    expect(await recipient(pat)).toEqual(before)
  })

  it('skips events for messages it does not know and still marks the file', async () => {
    const key = putFile([record('Delivery', 'not-ours', new Date())])

    await sweep()

    expect(
      await service.prisma.outreachEmailEventFile.findUnique({
        where: { key },
      }),
    ).not.toBeNull()
  })

  it('picks up a file that lands late in an earlier hour', async () => {
    putFile([record('Delivery', pat, new Date())])
    await sweep()

    const lateAt = subHours(new Date(), 2)
    putFile([record('Delivery', sam, lateAt)], lateAt)
    await sweep()

    expect((await recipient(sam)).deliveredAt).toEqual(lateAt)
  })

  it('reads nothing where no events bucket is configured', async () => {
    vi.stubEnv('SES_EVENTS_BUCKET', '')
    putFile([record('Delivery', pat, new Date())])

    await sweep()

    expect(listKeys).not.toHaveBeenCalled()
  })
})
