import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
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
const resolvePeopleDataset = vi.fn()

let ingest: OutreachTextIngestService
let outreach: Outreach
let textInteractions: ContactInteractionTextService

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
  resolvePeopleDataset.mockReset().mockResolvedValue({ base: 'constituents' })

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

  textInteractions = service.app.get(ContactInteractionTextService)

  const module = await Test.createTestingModule({
    providers: [
      OutreachTextIngestService,
      { provide: PrismaService, useValue: service.prisma },
      { provide: ContactInteractionTextService, useValue: textInteractions },
      {
        provide: ContactStatusService,
        useValue: service.app.get(ContactStatusService),
      },
      {
        provide: ContactsService,
        useValue: {
          findPersonByPhone,
          resolveProAccess,
          resolvePeopleDataset,
        },
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
      { base: 'constituents' },
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

  it('completes an in-progress expansion when a committed ingest completes the send', async () => {
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: outreach.id,
        topic: 'roads',
        audienceKind: 'sample',
        biasOverridden: false,
      },
    })
    const expansion = await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: outreach.id,
        sendSeq: 2,
        textCount: 5,
        status: OutreachStatus.in_progress,
      },
    })

    await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035550101', 'A reply')],
    })

    expect(
      (
        await service.prisma.outreachPollExpansion.findUniqueOrThrow({
          where: { id: expansion.id },
        })
      ).status,
    ).toBe(OutreachStatus.completed)
  })

  it('completes an expansion delivered after the spine was already completed', async () => {
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: outreach.id,
        topic: 'roads',
        audienceKind: 'sample',
        biasOverridden: false,
      },
    })
    await service.prisma.outreach.update({
      where: { id: outreach.id },
      data: { status: OutreachStatus.completed },
    })
    const expansion = await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: outreach.id,
        sendSeq: 2,
        textCount: 5,
        status: OutreachStatus.in_progress,
      },
    })

    await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035550101', 'A reply')],
    })

    expect(
      (
        await service.prisma.outreachPollExpansion.findUniqueOrThrow({
          where: { id: expansion.id },
        })
      ).status,
    ).toBe(OutreachStatus.completed)
  })

  it('merges two phones that resolve to one person at one instant, keeping the opt-out', async () => {
    // A forwarded message answered from a second number: both resolve to
    // person-1, and the deterministic id is the same for both.
    findPersonByPhone.mockResolvedValue({ id: 'person-1' })

    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'The park needs lights'),
        row('3035559999', 'STOP'),
      ],
    })

    // Both rows are attributed, so the counts still reconcile...
    expect(result.matched).toBe(2)
    expect(result.unmatched).toBe(0)
    expect(result.matched + result.unmatched).toBe(result.rowsParsed)
    // ...and the opt-out is reported because a row actually records it.
    expect(result.optOuts).toBe(1)

    const messages = await messagesForOutreach()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.isOptOut).toBe(true)
    expect(messages[0]?.content).toBe('The park needs lights STOP')
    // The opt-out must reach the CRM, not just the message row.
    expect((await interactionFor('person-1')).optedOutAt).toEqual(RECEIVED_AT)
  })

  it('merges rather than drops when rows carry no timestamp at all', async () => {
    // receivedAt is optional in the contract, and with it absent every
    // reply from one person shares an id — the collision is certain.
    findPersonByPhone.mockResolvedValue({ id: 'person-1' })

    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [
        row('3035550101', 'Fix the crosswalk', undefined),
        row('3035550101', 'And the streetlight', undefined),
        row('3035559999', 'unsubscribe', undefined),
      ],
    })

    expect(result.matched).toBe(3)
    expect(result.matched + result.unmatched).toBe(result.rowsParsed)
    expect(result.optOuts).toBe(1)

    const messages = await messagesForOutreach()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.isOptOut).toBe(true)
    expect(messages[0]?.content).toBe(
      'Fix the crosswalk And the streetlight unsubscribe',
    )
    expect((await interactionFor('person-1')).optedOutAt).not.toBeNull()
  })

  it('reports the same counts on a dry run of a colliding upload', async () => {
    findPersonByPhone.mockResolvedValue({ id: 'person-1' })
    const rows = [
      row('3035550101', 'The park needs lights'),
      row('3035559999', 'STOP'),
    ]

    const dry = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows,
      dryRun: true,
    })
    expect(await messagesForOutreach()).toHaveLength(0)

    const committed = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows,
    })
    expect(committed).toEqual({ ...dry, committed: true })
  })

  it('leaves the send in_progress when nothing matched, so a re-upload can fix it', async () => {
    const result = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      // The wrong file: not one number belongs to this send.
      rows: [row('9995550999', 'Who is this?'), row('9995550888', 'Wrong')],
    })

    expect(result).toEqual({
      rowsParsed: 2,
      matched: 0,
      unmatched: 2,
      optOuts: 0,
      committed: true,
    })
    expect(await messagesForOutreach()).toHaveLength(0)

    // The CAS is one-way, so completing here would be unrecoverable.
    const stillOpen = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(stillOpen.status).toBe(OutreachStatus.in_progress)

    // The corrected upload still completes it.
    await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035550101', 'The right file')],
    })
    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.status).toBe(OutreachStatus.completed)
  })

  it('still completes the send when the CRM write-back fails, and rethrows', async () => {
    // The message rows commit before step 5, so a write-back failure must
    // not leave the send stranded in_progress with its data already there.
    vi.spyOn(textInteractions, 'applyInboundEvent').mockRejectedValueOnce(
      new Error('connection terminated'),
    )

    await expect(
      ingest.ingestReplies({
        outreachId: outreach.id,
        sourceLabel: 'staff_upload',
        rows: [row('3035550101', 'STOP')],
      }),
    ).rejects.toThrow('connection terminated')

    // The rows are there, so the spine says so.
    expect(await messagesForOutreach()).toHaveLength(1)
    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(after.status).toBe(OutreachStatus.completed)
    // ...but the event genuinely did not land, which is why it rethrew.
    expect((await interactionFor('person-1')).optedOutAt).toBeNull()

    // The retry is the recovery path: everything is idempotent, so a
    // redelivery applies exactly the events that were missed.
    const retry = await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row('3035550101', 'STOP')],
    })
    expect(retry.committed).toBe(true)
    expect(await messagesForOutreach()).toHaveLength(1)
    expect((await interactionFor('person-1')).optedOutAt).toEqual(RECEIVED_AT)
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

describe('OutreachTextIngestService civic panel', () => {
  const EO_SLUG = 'eo-civic-panel-ingest'
  let panelOutreach: Outreach

  const seedServeSend = async (asksToJoinCivicPanel: boolean) => {
    await service.prisma.organization.upsert({
      where: { slug: EO_SLUG },
      create: { slug: EO_SLUG, ownerId: service.user.id },
      update: {},
    })
    panelOutreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: EO_SLUG,
        outreachType: OutreachType.text,
        status: OutreachStatus.in_progress,
        date: new Date(),
        asksToJoinCivicPanel,
      },
    })
    await service.prisma.outreachTextRecipient.createMany({
      data: [PERSON_1, PERSON_2].map((recipient) => ({
        outreachId: panelOutreach.id,
        organizationSlug: EO_SLUG,
        personId: recipient.personId,
        phone: recipient.phone,
      })),
    })
    await service.prisma.contactInteractionText.createMany({
      data: [PERSON_1, PERSON_2].map((recipient) => ({
        outreachId: panelOutreach.id,
        organizationSlug: EO_SLUG,
        personId: recipient.personId,
        occurredAt: new Date(),
      })),
    })
  }

  const panelStatus = async (personId: string) =>
    (
      await service.prisma.contactCurrentStatus.findUnique({
        where: {
          organizationSlug_personId_field: {
            organizationSlug: EO_SLUG,
            personId,
            field: 'civic_panel',
          },
        },
      })
    )?.value ?? 'left'

  const upload = (rows: IngestReplyRow[]) =>
    ingest.ingestReplies({
      outreachId: panelOutreach.id,
      sourceLabel: 'staff_upload',
      rows,
    })

  it('puts a JOIN reply on the panel when the send asked', async () => {
    await seedServeSend(true)

    await upload([
      row(PERSON_1.phone, 'JOIN'),
      row(PERSON_2.phone, 'I want to join the meeting on Tuesday'),
    ])

    expect(await panelStatus(PERSON_1.personId)).toBe('member')
    expect(await panelStatus(PERSON_2.personId)).toBe('left')
    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      personId: PERSON_1.personId,
      toValue: 'member',
      source: 'sms',
      actorUserId: null,
    })
  })

  it('ignores JOIN on a send that did not ask', async () => {
    await seedServeSend(false)

    await upload([row(PERSON_1.phone, 'JOIN')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('takes a member off the panel on STOP, on any send', async () => {
    await seedServeSend(false)
    await service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: EO_SLUG,
        personId: PERSON_1.personId,
        field: 'civic_panel',
        value: 'member',
      },
    })

    await upload([row(PERSON_1.phone, 'STOP')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('lets a later STOP win over an earlier JOIN listed after it', async () => {
    await seedServeSend(true)
    const joinedAt = new Date('2026-08-11T15:00:00.000Z')
    const stoppedAt = new Date('2026-08-11T16:00:00.000Z')

    await upload([
      row(PERSON_1.phone, 'STOP', stoppedAt),
      row(PERSON_1.phone, 'JOIN', joinedAt),
    ])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('never joins someone who opted out, even with a JOIN sent after the STOP', async () => {
    await seedServeSend(true)

    await upload([
      row(PERSON_1.phone, 'STOP', new Date('2026-08-11T15:00:00.000Z')),
      row(PERSON_1.phone, 'JOIN', new Date('2026-08-11T16:00:00.000Z')),
    ])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('skips a JOIN sent before a STOP that an earlier upload recorded', async () => {
    await seedServeSend(true)

    await upload([
      row(PERSON_1.phone, 'STOP', new Date('2026-08-11T16:00:00.000Z')),
    ])
    await upload([
      row(PERSON_1.phone, 'JOIN', new Date('2026-08-11T15:00:00.000Z')),
    ])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('writes nothing new when the same file is uploaded twice', async () => {
    await seedServeSend(true)

    await upload([row(PERSON_1.phone, 'join please')])
    await upload([row(PERSON_1.phone, 'join please')])

    expect(
      await service.prisma.contactStatusEvent.count({
        where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
      }),
    ).toBe(1)
  })

  const members = () =>
    service.prisma.contactCurrentStatus.count({
      where: {
        organizationSlug: EO_SLUG,
        field: 'civic_panel',
        value: 'member',
      },
    })

  it('puts a texted contact who replies JOIN twice on the panel once', async () => {
    await seedServeSend(true)

    await upload([row(PERSON_1.phone, 'JOIN')])
    await upload([
      row(PERSON_1.phone, 'JOIN', new Date('2026-08-12T15:00:00Z')),
    ])

    expect(await panelStatus(PERSON_1.personId)).toBe('member')
    expect(await members()).toBe(1)
  })

  it('ignores a JOIN from a number nobody holds', async () => {
    await seedServeSend(true)

    await upload([row('(303) 555-0199', 'JOIN')])

    expect(await members()).toBe(0)
    expect(
      await service.prisma.contactStatusEvent.count({
        where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
      }),
    ).toBe(0)
  })

  const seedMember = (personId: string) =>
    service.prisma.contactCurrentStatus.create({
      data: {
        organizationSlug: EO_SLUG,
        personId,
        field: 'civic_panel',
        value: 'member',
      },
    })

  it('takes a member who replies LEAVE off the panel without opting them out', async () => {
    await seedServeSend(false)
    await seedMember(PERSON_1.personId)

    await upload([row(PERSON_1.phone, 'Leave please')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      personId: PERSON_1.personId,
      fromValue: 'member',
      toValue: 'left',
      source: 'sms',
    })
    expect(
      await textInteractions.latestOptOutAt(EO_SLUG, PERSON_1.personId),
    ).toBeNull()
    expect(
      (await textInteractions.findOptedOutPersonIds(EO_SLUG)).includes(
        PERSON_1.personId,
      ),
    ).toBe(false)
  })

  it('writes nothing for a LEAVE from someone not on the panel', async () => {
    await seedServeSend(false)

    await upload([row(PERSON_1.phone, 'LEAVE')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
    expect(
      await service.prisma.contactStatusEvent.count({
        where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
      }),
    ).toBe(0)
  })

  it('writes one leave when the same LEAVE is uploaded twice', async () => {
    await seedServeSend(false)
    await seedMember(PERSON_1.personId)

    await upload([row(PERSON_1.phone, 'LEAVE')])
    await upload([row(PERSON_1.phone, 'LEAVE')])

    expect(
      await service.prisma.contactStatusEvent.count({
        where: { organizationSlug: EO_SLUG, field: 'civic_panel' },
      }),
    ).toBe(1)
  })

  it('still opts a member out of every text on STOP', async () => {
    await seedServeSend(false)
    await seedMember(PERSON_1.personId)

    await upload([row(PERSON_1.phone, 'STOP')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
    expect(
      await textInteractions.latestOptOutAt(EO_SLUG, PERSON_1.personId),
    ).not.toBeNull()
  })

  it('reads a reply that says JOIN and LEAVE as leaving', async () => {
    await seedServeSend(true)
    await seedMember(PERSON_1.personId)

    await upload([row(PERSON_1.phone, 'JOIN. LEAVE')])

    expect(await panelStatus(PERSON_1.personId)).toBe('left')
  })

  it('never writes panel membership for a Win send', async () => {
    await service.prisma.outreach.update({
      where: { id: outreach.id },
      data: { asksToJoinCivicPanel: true },
    })

    await ingest.ingestReplies({
      outreachId: outreach.id,
      sourceLabel: 'staff_upload',
      rows: [row(PERSON_1.phone, 'JOIN')],
    })

    expect(
      await service.prisma.contactStatusEvent.count({
        where: { field: 'civic_panel' },
      }),
    ).toBe(0)
  })
})
