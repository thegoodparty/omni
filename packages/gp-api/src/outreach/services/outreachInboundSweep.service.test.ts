import { BadGatewayException } from '@nestjs/common'
import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { useTestService } from '@/test-service'
import {
  PeerlyCdrCsvRow,
  PeerlyQuestionResponsesCsvRow,
} from '@/vendors/peerly/schemas/peerlyJobResultsReport.schema'
import {
  PeerlyJobResultsService,
  PeerlyReportDateWindow,
} from '@/vendors/peerly/services/peerlyJobResults.service'
import { Campaign, OutreachType } from '../../generated/prisma'
import { OutreachInboundSweepService } from './outreachInboundSweep.service'

const service = useTestService()

const fetchCdrRows =
  vi.fn<
    (
      jobId: string,
      window: PeerlyReportDateWindow,
    ) => Promise<PeerlyCdrCsvRow[]>
  >()
const fetchQuestionResponseRows =
  vi.fn<
    (
      jobId: string,
      window: PeerlyReportDateWindow,
    ) => Promise<PeerlyQuestionResponsesCsvRow[]>
  >()

const JOB_ID = 'peerly-job-1'
const PEERLY_LIST_ID = 4242
const OUR_DID = '18885550000'

// Redacted-style fixture phones, deliberately in different shapes (E.164,
// formatted, bare 11-digit) to exercise the shared digits-only normalizer.
const PERSON_1 = { personId: 'person-1', phone: '+13035550101' }
const PERSON_2 = { personId: 'person-2', phone: '(303) 555-0102' }
const PERSON_3 = { personId: 'person-3', phone: '13035550103' }
const PERSON_4 = { personId: 'person-4', phone: '3035550103' }

const BASE_CDR_ROW: PeerlyCdrCsvRow = {
  Timestamp: '2026-07-17 10:23:46',
  Direction: '',
  Agent_id: 'agent@1',
  Agent_name: 'GoodParty Engineering',
  Conversation_id: 'conv-1',
  From: '',
  To: '',
  Content: 'redacted',
  Chunk: '1',
  Result: 'SUCCESS',
  Cost: '0.036',
  Canvasser_rate: '',
  Unicode: '0',
  MMS: '0',
  'Media Url': '',
  Extern_id: '',
  Sublist_id: '',
  Title: '',
  First_name: '',
  Mid_name: '',
  Last_name: '',
  Suffix: '',
  Address1: '',
  Address2: '',
  City: '',
  State: '',
  Zip: '',
  Email: '',
  Aux_data1: '',
  Aux_data2: '',
  Aux_data3: '',
  Aux_data4: '',
  Aux_data5: '',
}

const BASE_QR_ROW: PeerlyQuestionResponsesCsvRow = {
  date: '2026-07-17 10:25:00',
  conversation_id: 'conv-1',
  agent_id: 'agent@1',
  agent_name: 'GoodParty Engineering',
  agent_email: 'eng@goodparty.org',
  from_did: OUR_DID,
  lead_phone: '',
  sublist_id: '',
  extern_id: '',
  first_name: '',
  mid_name: '',
  last_name: '',
  suffix: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  email: '',
  aux_data1: '',
  aux_data2: '',
  aux_data3: '',
  aux_data4: '',
  aux_data5: '',
  optout: '',
}

const replyRow = (fromPhone: string): PeerlyCdrCsvRow => ({
  ...BASE_CDR_ROW,
  Direction: 'received',
  From: fromPhone,
  To: OUR_DID,
})

const sentRow = (toPhone: string): PeerlyCdrCsvRow => ({
  ...BASE_CDR_ROW,
  Direction: 'sent',
  From: OUR_DID,
  To: toPhone,
})

const optOutRow = (
  leadPhone: string,
  optout = 'true',
): PeerlyQuestionResponsesCsvRow => ({
  ...BASE_QR_ROW,
  lead_phone: leadPhone,
  optout,
})

let campaign: Campaign
let orgSlug: string
let sweepService: OutreachInboundSweepService

const createSweepableOutreach = async (params?: {
  projectId?: string
  peerlyListId?: number
  recipients?: { personId: string; phone: string }[]
  interactionPersonIds?: string[]
  captureList?: boolean
}) => {
  const {
    projectId = JOB_ID,
    peerlyListId = PEERLY_LIST_ID,
    recipients = [PERSON_1, PERSON_2, PERSON_3, PERSON_4],
    captureList = true,
  } = params ?? {}
  const interactionPersonIds =
    params?.interactionPersonIds ??
    recipients.map((recipient) => recipient.personId)

  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      outreachType: OutreachType.p2p,
      projectId,
      phoneListId: peerlyListId,
      date: new Date(),
    },
  })

  if (captureList) {
    await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: orgSlug,
        campaignId: campaign.id,
        token: `token-${peerlyListId}`,
        peerlyListId,
        recipients: { createMany: { data: recipients } },
      },
    })
  }

  await service.prisma.contactInteractionText.createMany({
    data: interactionPersonIds.map((personId) => ({
      organizationSlug: orgSlug,
      personId,
      outreachId: outreach.id,
      occurredAt: new Date(),
    })),
  })

  return outreach
}

const findInteraction = (outreachId: number, personId: string) =>
  service.prisma.contactInteractionText.findUniqueOrThrow({
    where: { outreachId_personId: { outreachId, personId } },
  })

beforeEach(async () => {
  fetchCdrRows.mockReset().mockResolvedValue([])
  fetchQuestionResponseRows.mockReset().mockResolvedValue([])
  const resultsService = service.app.get(PeerlyJobResultsService)
  vi.spyOn(resultsService, 'fetchCdrRows').mockImplementation(fetchCdrRows)
  vi.spyOn(resultsService, 'fetchQuestionResponseRows').mockImplementation(
    fetchQuestionResponseRows,
  )

  sweepService = service.app.get(OutreachInboundSweepService)

  const campaignId = 6001
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
    },
  })
})

describe('OutreachInboundSweepService.sweepInboundEvents', () => {
  it('applies replies and opt-outs to exactly the matching rows, skipping duplicates, unknown phones, and non-opt-out flags', async () => {
    const outreach = await createSweepableOutreach()
    fetchCdrRows.mockResolvedValue([
      sentRow('13035550101'),
      replyRow('13035550101'),
      // Same lead phone again — same synthetic event, applied once.
      replyRow('13035550101'),
      // A phone Peerly reports that was never on the captured list.
      replyRow('19995550999'),
    ])
    fetchQuestionResponseRows.mockResolvedValue([
      optOutRow('3035550102'),
      optOutRow('3035550101', '0'),
    ])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).not.toBeNull()
    expect(person1.optedOutAt).toBeNull()
    expect(person1.sourceEventId).toBe(`peerly:${JOB_ID}:3035550101:reply`)

    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.optedOutAt).not.toBeNull()
    expect(person2.respondedAt).toBeNull()
    expect(person2.sourceEventId).toBe(`peerly:${JOB_ID}:3035550102:optout`)

    // Nobody else was touched, and no rows were invented for the unknown
    // phone.
    const allRows = await service.prisma.contactInteractionText.findMany()
    expect(allRows).toHaveLength(4)
    const untouched = allRows.filter(
      (row) => !['person-1', 'person-2'].includes(row.personId),
    )
    for (const row of untouched) {
      expect(row.respondedAt).toBeNull()
      expect(row.optedOutAt).toBeNull()
      expect(row.sourceEventId).toBeNull()
    }
  })

  it('does not move respondedAt when it is already set (first reply wins)', async () => {
    const firstReplyAt = new Date('2026-07-01T00:00:00Z')
    const outreach = await createSweepableOutreach()
    await service.prisma.contactInteractionText.update({
      where: {
        outreachId_personId: { outreachId: outreach.id, personId: 'person-1' },
      },
      data: { respondedAt: firstReplyAt },
    })
    fetchCdrRows.mockResolvedValue([replyRow('13035550101')])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).toEqual(firstReplyAt)
  })

  it('changes nothing when the sweep runs twice over the same events', async () => {
    const outreach = await createSweepableOutreach()
    fetchCdrRows.mockResolvedValue([replyRow('13035550101')])
    fetchQuestionResponseRows.mockResolvedValue([optOutRow('3035550102')])

    await sweepService.sweepInboundEvents()
    const afterFirst = await service.prisma.contactInteractionText.findMany({
      where: { outreachId: outreach.id },
      orderBy: { personId: 'asc' },
    })

    await sweepService.sweepInboundEvents()
    const afterSecond = await service.prisma.contactInteractionText.findMany({
      where: { outreachId: outreach.id },
      orderBy: { personId: 'asc' },
    })

    expect(afterSecond).toEqual(afterFirst)
  })

  it('records both a reply and an opt-out for the same person', async () => {
    const outreach = await createSweepableOutreach()
    fetchCdrRows.mockResolvedValue([replyRow('13035550101')])
    fetchQuestionResponseRows.mockResolvedValue([optOutRow('3035550101')])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).not.toBeNull()
    expect(person1.optedOutAt).not.toBeNull()

    // Re-running still changes nothing even though only one of the two
    // events could claim the row's single sourceEventId slot.
    const snapshot = { ...person1 }
    await sweepService.sweepInboundEvents()
    const rerun = await findInteraction(outreach.id, 'person-1')
    expect(rerun).toEqual(snapshot)
  })

  it('applies a reply to every captured recipient sharing the phone, stamping the event id on exactly one row', async () => {
    const outreach = await createSweepableOutreach()
    fetchCdrRows.mockResolvedValue([replyRow('13035550103')])

    await sweepService.sweepInboundEvents()

    const person3 = await findInteraction(outreach.id, 'person-3')
    const person4 = await findInteraction(outreach.id, 'person-4')
    expect(person3.respondedAt).not.toBeNull()
    expect(person4.respondedAt).not.toBeNull()
    const stamps = [person3.sourceEventId, person4.sourceEventId].filter(
      (id) => id !== null,
    )
    expect(stamps).toEqual([`peerly:${JOB_ID}:3035550103:reply`])
  })

  it('never creates a row for an event whose recipient has no materialized interaction row', async () => {
    const outreach = await createSweepableOutreach({
      interactionPersonIds: ['person-2'],
    })
    fetchCdrRows.mockResolvedValue([replyRow('13035550101')])

    await expect(sweepService.sweepInboundEvents()).resolves.toBeUndefined()

    const rows = await service.prisma.contactInteractionText.findMany({
      where: { outreachId: outreach.id },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.personId).toBe('person-2')
    expect(rows[0]?.respondedAt).toBeNull()
  })

  it('processes the remaining jobs when one job fails against Peerly', async () => {
    await createSweepableOutreach({
      projectId: 'job-fail',
      peerlyListId: 1111,
      recipients: [PERSON_1],
    })
    const healthy = await createSweepableOutreach({
      projectId: 'job-ok',
      peerlyListId: 2222,
      recipients: [PERSON_2],
    })
    fetchCdrRows.mockImplementation((jobId) =>
      jobId === 'job-fail'
        ? Promise.reject(new BadGatewayException('Peerly 5xx'))
        : Promise.resolve([replyRow('13035550102')]),
    )

    await expect(sweepService.sweepInboundEvents()).resolves.toBeUndefined()

    const person2 = await findInteraction(healthy.id, 'person-2')
    expect(person2.respondedAt).not.toBeNull()
  })

  it('does not poll outreaches past the inbound window', async () => {
    const outreach = await createSweepableOutreach()
    const stale = subDays(new Date(), 30)
    await service.prisma.$executeRaw`
      UPDATE outreach SET "updatedAt" = ${stale}, date = ${stale}
      WHERE id = ${outreach.id}
    `

    await sweepService.sweepInboundEvents()

    expect(fetchCdrRows).not.toHaveBeenCalled()
    expect(fetchQuestionResponseRows).not.toHaveBeenCalled()
  })

  it('still polls a completed-long-send outreach whose recent update keeps it inside the window', async () => {
    await createSweepableOutreach()

    await sweepService.sweepInboundEvents()

    expect(fetchCdrRows).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('skips Peerly entirely for an outreach whose phone list was never captured', async () => {
    await createSweepableOutreach({ captureList: false })

    await expect(sweepService.sweepInboundEvents()).resolves.toBeUndefined()

    expect(fetchCdrRows).not.toHaveBeenCalled()
    expect(fetchQuestionResponseRows).not.toHaveBeenCalled()
  })

  it('survives a concurrent replica winning the sourceEventId stamp between the read and the write', async () => {
    // Two sweep replicas fire the same cron. The race: replica A stamps the
    // event id onto one shared-phone row after replica B's duplicate
    // pre-screen already passed, so B's stamp write trips the
    // (organizationSlug, sourceEventId) unique index. Simulated via a direct
    // service call with the id pre-stamped on a sibling row.
    const outreach = await createSweepableOutreach()
    const sourceEventId = `peerly:${JOB_ID}:3035550103:reply`
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: orgSlug,
        personId: 'person-raced',
        occurredAt: new Date(),
        sourceEventId,
      },
    })
    const textInteractions = service.app.get(ContactInteractionTextService)

    const outcome = await textInteractions.applyInboundEvent({
      outreachId: outreach.id,
      personIds: ['person-3', 'person-4'],
      eventType: 'reply',
      sourceEventId,
      observedAt: new Date(),
    })

    expect(outcome).toBe('applied')
    const person3 = await findInteraction(outreach.id, 'person-3')
    const person4 = await findInteraction(outreach.id, 'person-4')
    expect(person3.respondedAt).not.toBeNull()
    expect(person4.respondedAt).not.toBeNull()
    expect(person3.sourceEventId).toBeNull()
    expect(person4.sourceEventId).toBeNull()
  })
})
