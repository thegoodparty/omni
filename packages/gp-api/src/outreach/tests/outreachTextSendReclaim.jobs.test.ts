import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OutreachStatus, OutreachType } from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  type TextDeliveryHandoff,
  type TextDeliveryHandoffPort,
} from '../interfaces/textDeliveryHandoff.interface'
import { OutreachTextDeliveryService } from '../services/outreachTextDelivery.service'
import { outreachTextSendJob } from '../util/outreachTextSendJob.util'

// An outreachTextSend attempt that dies holding the send's claim, run for
// real with only S3, people data and the fulfilment handoff stubbed. The
// job's retry re-claims the send and hands it off exactly once
// (docs/adr/2026-11-11-text-send-reclaim-on-pg-boss-retry.md).
const service = useTestService({ jobs: true })

const SLUG = 'eo-text-reclaim'

let handoffs: TextDeliveryHandoff[]
let objects: Map<string, string>

beforeEach(() => {
  vi.stubEnv('OUTREACH_TEXT_CSVS_BUCKET', 'reclaim-csvs')
  handoffs = []
  const port: TextDeliveryHandoffPort = service.app.get(
    TEXT_DELIVERY_HANDOFF_PORT,
  )
  vi.spyOn(port, 'send').mockImplementation(async (handoff) => {
    handoffs.push(handoff)
  })
  objects = new Map()
  const s3 = service.app.get(S3Service)
  vi.spyOn(s3, 'getFile').mockImplementation(async (bucket, key) =>
    objects.get(`${bucket}/${key}`),
  )
  vi.spyOn(s3, 'uploadFile').mockImplementation(async (bucket, body, key) => {
    objects.set(`${bucket}/${key}`, body as string)
    return `https://${bucket}/${key}`
  })
  vi.spyOn(
    service.app.get(ContactsService),
    'findContactsForFilter',
  ).mockResolvedValue({
    people: [
      {
        id: 'p-1',
        firstName: 'Jane',
        lastName: 'Doe',
        cellPhone: '5551230001',
      },
      { id: 'p-2', firstName: 'Joe', lastName: 'Roe', cellPhone: '5551230002' },
    ],
    pagination: { totalResults: 2 },
  } as never)
})

const seedPaidSend = async () => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: SLUG, name: 'constituents' },
  })
  return service.prisma.outreach.create({
    data: {
      organizationSlug: SLUG,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending,
      message: 'Trash pickup moves to Thursday.',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: filter.id,
      textCount: 2,
      stripeCheckoutSessionId: `cs_test_${SLUG}`,
    },
  })
}

const sendJob = (outreachId: number) =>
  service.app
    .get(JobsService)
    .sendMany('outreachTextSend', [
      outreachTextSendJob({ outreachId, sendSeq: 1 }),
    ])

const recipientCount = (outreachId: number) =>
  service.prisma.outreachTextRecipient.count({ where: { outreachId } })

describe('an outreachTextSend attempt that dies holding its claim', () => {
  it('is re-claimed by the retry, which hands the send off once', async () => {
    const outreach = await seedPaidSend()
    // The first attempt fails before any recipient is written, and its
    // hand-back fails too, as when the task is killed: the row stays
    // in_progress under the first attempt's stamp.
    vi.spyOn(service.app.get(S3Service), 'uploadFile').mockRejectedValueOnce(
      new Error('S3 down'),
    )
    const outreachRows = service.prisma.outreach
    const updateMany = outreachRows.updateMany.bind(outreachRows)
    let handBacks = 0
    vi.spyOn(outreachRows, 'updateMany').mockImplementation(((args) => {
      if (
        args.data.status === OutreachStatus.pending &&
        args.where?.sendClaimedAt !== undefined &&
        handBacks++ === 0
      ) {
        return Promise.reject(new Error('task killed'))
      }
      return updateMany(args)
    }) as typeof outreachRows.updateMany)

    await sendJob(outreach.id)
    await service.jobs.settle()

    expect(handBacks).toBe(1)
    expect(handoffs).toEqual([
      expect.objectContaining({
        outreachId: String(outreach.id),
        recipientCount: 2,
      }),
    ])
    expect(await recipientCount(outreach.id)).toBe(2)
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreach.id },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)
  })

  it('stops an expired attempt still running from posting beside its retry', async () => {
    const outreach = await seedPaidSend()
    const delivery = service.app.get(OutreachTextDeliveryService)
    const requestSend = delivery.requestSend.bind(delivery)
    const attempts: Array<Promise<unknown>> = []
    vi.spyOn(delivery, 'requestSend').mockImplementation((input) => {
      const attempt = requestSend(input)
      attempts.push(attempt)
      return attempt
    })
    // The first attempt stalls writing its CSV, after its claim.
    let release: () => void = () => undefined
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    let uploads = 0
    vi.spyOn(service.app.get(S3Service), 'uploadFile').mockImplementation(
      async (bucket, body, key) => {
        if (uploads++ === 0) await stalled
        objects.set(`${bucket}/${key}`, body as string)
        return `https://${bucket}/${key}`
      },
    )

    await sendJob(outreach.id)
    await vi.waitFor(() => expect(uploads).toBe(1))
    // What pg-boss does when the attempt passes timeoutMinutes: the job
    // goes back to retry while its handler runs on.
    await service.prisma.$executeRaw`
      UPDATE pgboss.job SET state = 'retry', start_after = now()
      WHERE name = 'outreachTextSend' AND state = 'active'`
    await service.jobs.settle()
    expect(handoffs).toHaveLength(1)

    release()
    const [first, second] = await Promise.allSettled(attempts)
    expect(first).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('lost its claim'),
      }),
    })
    expect(second).toMatchObject({ status: 'fulfilled' })
    expect(handoffs).toHaveLength(1)
    expect(await recipientCount(outreach.id)).toBe(2)
  })
})
