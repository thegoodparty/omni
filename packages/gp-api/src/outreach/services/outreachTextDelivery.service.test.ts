import { BadRequestException } from '@nestjs/common'
import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OutreachStatus, OutreachType } from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { useTestService } from '@/test-service'
import {
  TextDeliveryHandoff,
  TextDeliveryHandoffPort,
} from '../interfaces/textDeliveryHandoff.interface'
import { OutreachTextDeliveryService } from './outreachTextDelivery.service'

const service = useTestService()

const ORG_SLUG = 'eo-text-delivery'
const BUCKET = 'text-delivery-csvs'

const person = (id: string, cellPhone: string): Person =>
  ({
    id,
    firstName: 'Jane',
    lastName: 'Doe',
    cellPhone,
    address: { city: 'Springfield', state: 'CA', zip: '90210' },
  }) as Person

// resolveFilterAudience only reads `people`; the rest of PeopleListResponse
// is irrelevant to it.
const peoplePage = (people: Person[]) =>
  ({ people }) as unknown as PeopleListResponse

/** A stand-in S3 that remembers what was written, so get-or-create is real. */
const makeS3Stub = () => {
  const objects = new Map<string, string>()
  return {
    objects,
    getFile: vi.fn((bucket: string, key: string) =>
      Promise.resolve(objects.get(`${bucket}/${key}`)),
    ),
    uploadFile: vi.fn((bucket: string, body: string, key: string) => {
      objects.set(`${bucket}/${key}`, body)
      return Promise.resolve(`https://${bucket}/${key}`)
    }),
  }
}

describe('OutreachTextDeliveryService', () => {
  let delivery: OutreachTextDeliveryService
  let contacts: ContactsService
  let s3: ReturnType<typeof makeS3Stub>
  let handoffs: TextDeliveryHandoff[]
  let handoffPort: TextDeliveryHandoffPort
  let warn: ReturnType<typeof vi.fn>

  const seedSend = async (
    opts: { status?: OutreachStatus; slug?: string } = {},
  ) => {
    const slug = opts.slug ?? ORG_SLUG
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'constituents' },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        voterFileFilterId: filter.id,
        status: opts.status ?? OutreachStatus.pending,
      },
    })
    return { slug, filter, outreach }
  }

  const input = (outreachId: number, overrides = {}) => ({
    outreachId,
    audience: { kind: 'savedFilter' as const, voterFileFilterId: 0 },
    message: 'A note from your council member.',
    scheduledLocalDate: '2026-10-05',
    sendSeq: 1,
    ...overrides,
  })

  const recipientRows = (outreachId: number) =>
    service.prisma.outreachTextRecipient.findMany({
      where: { outreachId },
      orderBy: { personId: 'asc' },
    })

  const interactionRows = (outreachId: number) =>
    service.prisma.contactInteractionText.findMany({
      where: { outreachId },
      orderBy: { personId: 'asc' },
    })

  // A redelivery that matters is one where the previous attempt died before
  // the spine advanced, so the row is still `pending`. Simulate that rather
  // than calling requestSend twice against an `in_progress` row, which the
  // claim correctly refuses.
  const resetToPending = (outreachId: number) =>
    service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.pending },
    })

  const statusOf = async (outreachId: number) =>
    (
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
        select: { status: true },
      })
    ).status

  beforeEach(() => {
    process.env.OUTREACH_TEXT_CSVS_BUCKET = BUCKET
    contacts = service.app.get(ContactsService)
    s3 = makeS3Stub()
    handoffs = []
    handoffPort = {
      send: vi.fn((handoff: TextDeliveryHandoff) => {
        handoffs.push(handoff)
        return Promise.resolve()
      }),
    }
    warn = vi.fn()
    const logger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    } as unknown as PinoLogger

    // The service is not in a module yet (B1 wires it), so build it by hand
    // and hand it the two properties createPrismaBase injects.
    delivery = new OutreachTextDeliveryService(
      contacts,
      service.app.get(VoterFileFilterService),
      service.app.get(ContactInteractionTextService),
      s3 as unknown as S3Service,
      handoffPort,
    )
    Reflect.set(delivery, '_prisma', service.prisma)
    Reflect.set(delivery, 'logger', logger)
    delivery.onModuleInit()
  })

  it('resolves a saved filter, writes the CSV, captures recipients and advances the spine', async () => {
    const { outreach, filter } = await seedSend()
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(
        peoplePage([person('p-1', '5551230001'), person('p-2', '5551230002')]),
      )

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(result).toEqual({
      recipientCount: 2,
      excludedOptedOutCount: 0,
      excludedDuplicateCount: 0,
      sendKey: `${outreach.id}-1.csv`,
    })
    expect(findContactsForFilter).toHaveBeenCalledTimes(1)

    const csv = s3.objects.get(`${BUCKET}/${outreach.id}-1.csv`)
    expect(csv?.split('\n')[0]).toBe('id,firstName,lastName,cellPhone')
    expect(csv?.split('\n')).toHaveLength(3)

    expect((await recipientRows(outreach.id)).map((r) => r.personId)).toEqual([
      'p-1',
      'p-2',
    ])
    expect((await interactionRows(outreach.id)).map((r) => r.personId)).toEqual(
      ['p-1', 'p-2'],
    )
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]).toMatchObject({
      outreachId: String(outreach.id),
      sendSeq: 1,
      recipientCount: 2,
      message: 'A note from your council member.',
    })
    expect(handoffs[0]?.csv.fileContent.toString()).toBe(csv)
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
  })

  it('reuses the object at the deterministic key instead of resampling', async () => {
    const { outreach, filter } = await seedSend()
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage([person('p-1', '5551230001')]))
    const args = input(outreach.id, {
      audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
    })

    const first = await delivery.requestSend(args)

    // A different audience on the second pass: if the key were not honored,
    // the recipient rows would change.
    findContactsForFilter.mockResolvedValue(
      peoplePage([person('p-9', '5559990009')]),
    )
    await resetToPending(outreach.id)
    const second = await delivery.requestSend(args)

    expect(second.sendKey).toBe(first.sendKey)
    expect(findContactsForFilter).toHaveBeenCalledTimes(1)
    expect(s3.uploadFile).toHaveBeenCalledTimes(1)
    expect((await recipientRows(outreach.id)).map((r) => r.personId)).toEqual([
      'p-1',
    ])
    expect(await interactionRows(outreach.id)).toHaveLength(1)
    expect(handoffs).toHaveLength(2)
  })

  it('keys the CSV on sendSeq, so an expansion resolves its own audience', async () => {
    const { outreach, filter } = await seedSend()
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage([person('p-1', '5551230001')]))

    await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )
    findContactsForFilter.mockResolvedValue(
      peoplePage([person('p-2', '5551230002')]),
    )
    await resetToPending(outreach.id)
    const second = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
        sendSeq: 2,
      }),
    )

    expect(second.sendKey).toBe(`${outreach.id}-2.csv`)
    expect(findContactsForFilter).toHaveBeenCalledTimes(2)
    expect((await recipientRows(outreach.id)).map((r) => r.personId)).toEqual([
      'p-1',
      'p-2',
    ])
  })

  it('scrubs opted-out people and reports how many were excluded', async () => {
    const { outreach, filter, slug } = await seedSend()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: 'p-optout',
        occurredAt: new Date(),
        optedOutAt: new Date(),
      },
    })
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage([person('p-1', '5551230001')]))

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(result.excludedOptedOutCount).toBe(1)
    expect(findContactsForFilter.mock.calls[0]?.[3]).toEqual(
      new Set(['p-optout']),
    )
  })

  it('reports the duplicate phones the resolution dropped', async () => {
    const { outreach, filter } = await seedSend()
    vi.spyOn(contacts, 'findContactsForFilter').mockResolvedValue(
      peoplePage([
        person('p-1', '5551230001'),
        person('p-2', '5551230001'),
        person('p-3', '5551230003'),
      ]),
    )

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(result).toMatchObject({
      recipientCount: 2,
      excludedDuplicateCount: 1,
    })
    expect((await recipientRows(outreach.id)).map((r) => r.personId)).toEqual([
      'p-1',
      'p-3',
    ])
  })

  it('resolves the sample branch, which no product calls yet', async () => {
    const { outreach } = await seedSend()
    const sampleContacts = vi
      .spyOn(contacts, 'sampleContacts')
      .mockResolvedValue([
        person('s-1', '5552220001'),
        person('s-2', '5552220001'),
        person('s-3', '5552220003'),
      ] as never)

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'sample', size: 3, excludePersonIds: ['skip-me'] },
      }),
    )

    expect(sampleContacts).toHaveBeenCalledWith(
      { size: 3, excludeIds: ['skip-me'] },
      expect.objectContaining({ slug: ORG_SLUG }),
    )
    // Dedupe applies to the sample branch too — the capture row is a
    // phone-to-person map either way.
    expect(result).toMatchObject({
      recipientCount: 2,
      excludedDuplicateCount: 1,
    })
    expect((await recipientRows(outreach.id)).map((r) => r.personId)).toEqual([
      's-1',
      's-3',
    ])
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
  })

  it('merges the opt-out scrub into the sample branch exclusions', async () => {
    const { outreach, slug } = await seedSend()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: 'p-optout',
        occurredAt: new Date(),
        optedOutAt: new Date(),
      },
    })
    const sampleContacts = vi
      .spyOn(contacts, 'sampleContacts')
      .mockResolvedValue([person('s-1', '5552220001')] as never)

    const result = await delivery.requestSend(
      input(outreach.id, { audience: { kind: 'sample', size: 1 } }),
    )

    expect(sampleContacts).toHaveBeenCalledWith(
      { size: 1, excludeIds: ['p-optout'] },
      expect.objectContaining({ slug }),
    )
    expect(result.excludedOptedOutCount).toBe(1)
  })

  it('hands a canceled send off to nobody', async () => {
    const { outreach, filter } = await seedSend({
      status: OutreachStatus.canceled,
    })
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage([person('p-1', '5551230001')]))

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    // Nothing irreversible: no audience resolved, no CSV, no capture rows,
    // and above all nothing sitting in a human's queue to send.
    expect(findContactsForFilter).not.toHaveBeenCalled()
    expect(s3.uploadFile).not.toHaveBeenCalled()
    expect(handoffPort.send).not.toHaveBeenCalled()
    expect(await recipientRows(outreach.id)).toHaveLength(0)
    expect(await interactionRows(outreach.id)).toHaveLength(0)
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.canceled)
    expect(result).toMatchObject({ recipientCount: 0 })
  })

  it('does nothing for a send the spine has already advanced', async () => {
    const { outreach, filter } = await seedSend({
      status: OutreachStatus.in_progress,
    })
    vi.spyOn(contacts, 'findContactsForFilter').mockResolvedValue(
      peoplePage([person('p-1', '5551230001')]),
    )

    await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(handoffPort.send).not.toHaveBeenCalled()
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
  })

  it('claims the send before resolving, so a cancel cannot race the handoff', async () => {
    const { outreach, filter } = await seedSend()
    // The claim has to land before the first irreversible step, so by the
    // time the audience is being resolved the row is no longer cancelable.
    vi.spyOn(contacts, 'findContactsForFilter').mockImplementation(async () => {
      expect(await statusOf(outreach.id)).toBe(OutreachStatus.in_progress)
      return peoplePage([person('p-1', '5551230001')])
    })

    await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(handoffPort.send).toHaveBeenCalledTimes(1)
  })

  it('gives the claim back when the handoff fails, so a retry can run', async () => {
    const { outreach, filter } = await seedSend()
    vi.spyOn(contacts, 'findContactsForFilter').mockResolvedValue(
      peoplePage([person('p-1', '5551230001')]),
    )
    vi.mocked(handoffPort.send).mockRejectedValueOnce(new Error('slack down'))

    await expect(
      delivery.requestSend(
        input(outreach.id, {
          audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
        }),
      ),
    ).rejects.toThrow('slack down')

    expect(await statusOf(outreach.id)).toBe(OutreachStatus.pending)
  })

  it('hands off nothing when the audience resolves empty', async () => {
    const { outreach, filter } = await seedSend()
    vi.spyOn(contacts, 'findContactsForFilter').mockResolvedValue(
      peoplePage([]),
    )

    await expect(
      delivery.requestSend(
        input(outreach.id, {
          audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
        }),
      ),
    ).rejects.toThrow(BadRequestException)

    expect(s3.uploadFile).not.toHaveBeenCalled()
    expect(handoffPort.send).not.toHaveBeenCalled()
    // The claim is handed back, so fixing the list and retrying works.
    expect(await statusOf(outreach.id)).toBe(OutreachStatus.pending)
  })

  it('rejects a saved list that belongs to another organization', async () => {
    const { outreach } = await seedSend()
    await service.prisma.organization.create({
      data: { slug: 'eo-other', ownerId: service.user.id },
    })
    const otherFilter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: 'eo-other', name: 'not yours' },
    })

    await expect(
      delivery.requestSend(
        input(outreach.id, {
          audience: { kind: 'savedFilter', voterFileFilterId: otherFilter.id },
        }),
      ),
    ).rejects.toThrow(BadRequestException)
    expect(handoffPort.send).not.toHaveBeenCalled()
  })

  it('skips the scrub, loudly, when the opt-out set is over the id cap', async () => {
    const { outreach, filter } = await seedSend()
    // Seeding 100k rows is not a test; the cap check is what is under test,
    // so stub the producer at the size that trips it.
    const overCap = Array.from(
      { length: MAX_RESOLVED_ID_SET_SIZE + 1 },
      (_unused, i) => `opted-out-${i}`,
    )
    vi.spyOn(
      service.app.get(ContactInteractionTextService),
      'findOptedOutPersonIds',
    ).mockResolvedValue(overCap)
    const findContactsForFilter = vi
      .spyOn(contacts, 'findContactsForFilter')
      .mockResolvedValue(peoplePage([person('p-1', '5551230001')]))

    const result = await delivery.requestSend(
      input(outreach.id, {
        audience: { kind: 'savedFilter', voterFileFilterId: filter.id },
      }),
    )

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ optedOutCount: overCap.length }),
      expect.stringContaining('exceeds the people-api id-filter cap'),
    )
    // The send proceeds unscrubbed rather than blocking, and the returned
    // count cannot distinguish that from "nobody opted out" — see the PR body.
    expect(findContactsForFilter.mock.calls[0]?.[3]).toEqual(new Set())
    expect(result.excludedOptedOutCount).toBe(0)
    expect(result.recipientCount).toBe(1)
  })
})
