import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
} from '../../generated/prisma'
import {
  IngestReplyRow,
  OutreachTextIngestService,
} from './outreachTextIngest.service'

const service = useTestService()

const ORG_SLUG = 'serve-org-ingest'

// Deliberately different shapes — the recipient map, the upload and the
// People DB all spell a phone differently, and the layer compares digits.
const PERSON_1 = { personId: 'person-1', phone: '+13035550101' }
const PERSON_2 = { personId: 'person-2', phone: '(303) 555-0102' }
const PERSON_3 = { personId: 'person-3', phone: '13035550103' }

const RECEIVED_AT = new Date('2026-08-11T15:04:05.000Z')

const findPersonByPhone = vi.fn()
const resolveProAccess = vi.fn()

let ingest: OutreachTextIngestService
let outreach: Outreach

const row = (
  phone: string,
  content: string,
  receivedAt: Date | undefined = RECEIVED_AT,
): IngestReplyRow => ({ phone, content, receivedAt })

const messagesForOutreach = () =>
  service.prisma.pollIndividualMessage.findMany({
    where: { outreachId: outreach.id },
    orderBy: { personId: 'asc' },
  })

const interactionFor = (personId: string) =>
  service.prisma.contactInteractionText.findUniqueOrThrow({
    where: { outreachId_personId: { outreachId: outreach.id, personId } },
  })

beforeEach(async () => {
  findPersonByPhone.mockReset().mockResolvedValue(null)
  resolveProAccess.mockReset().mockResolvedValue(true)

  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: ORG_SLUG, userId: service.user.id },
  })

  outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.text,
      status: OutreachStatus.in_progress,
      date: new Date(),
    },
  })

  const recipients = [PERSON_1, PERSON_2, PERSON_3]
  await service.prisma.outreachTextRecipient.createMany({
    data: recipients.map((recipient) => ({
      outreachId: outreach.id,
      organizationSlug: ORG_SLUG,
      personId: recipient.personId,
      phone: recipient.phone,
    })),
  })
  // The outbound half materializes one interaction row per recipient; the
  // inbound half only ever updates them.
  await service.prisma.contactInteractionText.createMany({
    data: recipients.map((recipient) => ({
      outreachId: outreach.id,
      organizationSlug: ORG_SLUG,
      personId: recipient.personId,
      occurredAt: new Date(),
    })),
  })

  const module = await Test.createTestingModule({
    providers: [
      OutreachTextIngestService,
      { provide: PrismaService, useValue: service.prisma },
      {
        provide: ContactInteractionTextService,
        useValue: service.app.get(ContactInteractionTextService),
      },
      {
        provide: ContactsService,
        useValue: { findPersonByPhone, resolveProAccess },
      },
      { provide: PinoLogger, useValue: createMockLogger() },
    ],
  }).compile()
  await module.init()
  ingest = module.get(OutreachTextIngestService)
})

describe('OutreachTextIngestService.ingestReplies', () => {
  it('writes message rows, applies reply events and completes the send', async () => {
    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'The potholes on Elm are getting worse'),
        row('+1 (303) 555-0102', 'Thanks for reaching out about the park'),
      ],
    })

    expect(result).toEqual({
      rowsParsed: 2,
      matched: 2,
      unmatched: 0,
      optOuts: 0,
      committed: true,
    })

    const messages = await messagesForOutreach()
    expect(messages).toHaveLength(2)
    for (const message of messages) {
      expect(message.pollId).toBeNull()
      expect(message.outreachId).toBe(outreach.id)
      expect(message.sender).toBe(PollIndividualMessageSender.CONSTITUENT)
      expect(message.electedOfficeId).not.toBeNull()
      expect(message.sentAt).toEqual(RECEIVED_AT)
      expect(message.isOptOut).toBe(false)
    }
    expect(messages[0]?.personCellPhone).toBe('+13035550101')

    const person1 = await interactionFor('person-1')
    expect(person1.respondedAt).toEqual(RECEIVED_AT)
    expect(person1.optedOutAt).toBeNull()
    expect(person1.sourceEventId).toBe(messages[0]?.id)

    // Nobody who never replied was touched.
    const person3 = await interactionFor('person-3')
    expect(person3.respondedAt).toBeNull()
    expect(person3.sourceEventId).toBeNull()

    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.status).toBe(OutreachStatus.completed)
  })

  it('is idempotent: re-ingesting the same rows replaces its own rows and adds nothing', async () => {
    const rows = [
      row('3035550101', 'The potholes on Elm are getting worse'),
      row('3035550102', 'STOP'),
    ]
    const first = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'analysis_pipeline',
      rows,
    })
    const firstMessages = await messagesForOutreach()
    const firstRespondedAt = (await interactionFor('person-1')).respondedAt

    const second = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'analysis_pipeline',
      rows,
    })

    expect(second).toEqual(first)
    const secondMessages = await messagesForOutreach()
    expect(secondMessages).toHaveLength(firstMessages.length)
    expect(secondMessages.map((message) => message.id)).toEqual(
      firstMessages.map((message) => message.id),
    )
    // First reply wins; a re-ingest never re-stamps a later timestamp.
    expect((await interactionFor('person-1')).respondedAt).toEqual(
      firstRespondedAt,
    )
  })

  it('skips an unattributable reply and reports it rather than throwing', async () => {
    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'Real reply from a real recipient'),
        // Never on the send, and the People DB does not know it either.
        row('9995550999', 'Who is this?'),
        // Not a phone number at all.
        row('not-a-phone', 'Garbage row'),
      ],
    })

    expect(result).toEqual({
      rowsParsed: 3,
      matched: 1,
      unmatched: 2,
      optOuts: 0,
      committed: true,
    })
    expect(await messagesForOutreach()).toHaveLength(1)
  })

  it('falls back to the People DB for a phone that was not on the send', async () => {
    findPersonByPhone.mockResolvedValue({ id: 'person-forwarded' })

    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035559999', 'My neighbor forwarded me this')],
    })

    expect(result.matched).toBe(1)
    expect(result.unmatched).toBe(0)
    expect(findPersonByPhone).toHaveBeenCalledWith(
      '3035559999',
      expect.objectContaining({ slug: ORG_SLUG }),
      true,
    )
    const messages = await messagesForOutreach()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.personId).toBe('person-forwarded')
  })

  it('does not poison-pill the batch when a People DB lookup throws', async () => {
    findPersonByPhone.mockRejectedValue(new Error('people-api down'))

    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'A reply that must still land'),
        row('3035559999', 'A forwarded reply we cannot resolve'),
      ],
    })

    expect(result.matched).toBe(1)
    expect(result.unmatched).toBe(1)
    expect(await messagesForOutreach()).toHaveLength(1)
  })

  it('detects opt-outs with its own predicate and writes optedOutAt', async () => {
    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'STOP'),
        // Reads as an opt-out to a looser last-word rule; it is feedback.
        row('3035550102', 'Please stop the warehouse project'),
        row('3035550103', 'Remove me from your list'),
      ],
    })

    expect(result.optOuts).toBe(2)

    const messages = await messagesForOutreach()
    expect(messages.map((message) => message.isOptOut)).toEqual([
      true,
      false,
      true,
    ])

    expect((await interactionFor('person-1')).optedOutAt).toEqual(RECEIVED_AT)
    expect((await interactionFor('person-2')).optedOutAt).toBeNull()
    expect((await interactionFor('person-3')).optedOutAt).toEqual(RECEIVED_AT)
    // An opt-out is also a reply.
    expect((await interactionFor('person-1')).respondedAt).toEqual(RECEIVED_AT)
  })

  it('groups the rows one reply was split into, and opts out on any atom', async () => {
    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'analysis_pipeline',
      rows: [
        row('3035550101', 'The park needs lights'),
        row('3035550101', 'Also the crosswalk is faded'),
        row('3035550101', 'STOP'),
        // Same phone, different timestamp — a separate reply.
        row(
          '3035550101',
          'One more thing',
          new Date('2026-08-12T15:04:05.000Z'),
        ),
      ],
    })

    expect(result).toEqual({
      rowsParsed: 4,
      matched: 4,
      unmatched: 0,
      optOuts: 1,
      committed: true,
    })

    const messages = await messagesForOutreach()
    expect(messages).toHaveLength(2)
    const grouped = messages.find((message) => message.isOptOut)
    expect(grouped?.content).toBe(
      'The park needs lights Also the crosswalk is faded STOP',
    )
  })

  it('writes nothing on a dry run but reports the same counts', async () => {
    const rows = [
      row('3035550101', 'The potholes on Elm are getting worse'),
      row('3035550102', 'STOP'),
      row('9995550999', 'Who is this?'),
    ]

    const dry = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows,
      dryRun: true,
    })

    expect(dry).toEqual({
      rowsParsed: 3,
      matched: 2,
      unmatched: 1,
      optOuts: 1,
      committed: false,
    })
    expect(await messagesForOutreach()).toHaveLength(0)
    expect((await interactionFor('person-1')).respondedAt).toBeNull()
    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreach.id },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)

    // ...and the commit that follows reports the same thing.
    const committed = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows,
    })
    expect(committed).toEqual({ ...dry, committed: true })
  })

  it('only advances the status from in_progress', async () => {
    await service.prisma.outreach.update({
      where: { id: outreach.id },
      data: { status: OutreachStatus.canceled },
    })

    await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035550101', 'A late reply')],
    })

    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.status).toBe(OutreachStatus.canceled)
  })

  it('throws for an outreach that does not exist', async () => {
    await expect(
      ingest.ingestReplies({
        outreachId: outreach.id + 9999,
        sourceLabel: 'staff_upload',
        rows: [row('3035550101', 'Hello')],
      }),
    ).rejects.toThrow(NotFoundException)
  })
})
