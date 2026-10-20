import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import {
  addDays,
  addHours,
  addMilliseconds,
  set,
  subDays,
  subHours,
  subSeconds,
} from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { useTestService } from '@/test-service'
import {
  PeerlyCdrCsvRow,
  PeerlyQuestionResponsesCsvRow,
} from '@/vendors/peerly/schemas/peerlyJobResultsReport.schema'
import {
  PeerlyJobResultsService,
  PeerlyReportDateWindow,
  PeerlyReportRequestOptions,
} from '@/vendors/peerly/services/peerlyJobResults.service'
import { Campaign, OutreachType } from '../../generated/prisma'
import {
  INBOUND_SWEEP_AGED_HOUR_INTERVAL,
  INBOUND_SWEEP_FRESH_WINDOW_DAYS,
  OPT_OUT_RECONCILE_BUDGET_MS,
  OPT_OUT_RECONCILE_CONCURRENCY,
  OPT_OUT_RECONCILE_INTERVAL_HOURS,
  OPT_OUT_RECONCILE_WINDOW_DAYS,
  OutreachInboundSweepService,
} from './outreachInboundSweep.service'

const service = useTestService()

const fetchInboundCdrRows =
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
      request?: PeerlyReportRequestOptions,
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

const replyRow = (
  fromPhone: string,
  content = 'Who is this?',
): PeerlyCdrCsvRow => ({
  ...BASE_CDR_ROW,
  Direction: 'received',
  From: fromPhone,
  To: OUR_DID,
  Content: content,
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

const loggerInfoSpy = () =>
  vi.spyOn((sweepService as unknown as { logger: PinoLogger }).logger, 'info')

const setOutreachDate = (outreachId: number, date: Date) =>
  service.prisma.$executeRaw`
    UPDATE outreach SET date = ${date} WHERE id = ${outreachId}
  `

// Raw so Prisma's @updatedAt doesn't overwrite the value being set.
const setOutreachUpdatedAt = (outreachId: number, updatedAt: Date) =>
  service.prisma.$executeRaw`
    UPDATE outreach SET "updatedAt" = ${updatedAt} WHERE id = ${outreachId}
  `

beforeEach(async () => {
  vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
  fetchInboundCdrRows.mockReset().mockResolvedValue([])
  fetchQuestionResponseRows.mockReset().mockResolvedValue([])
  const resultsService = service.app.get(PeerlyJobResultsService)
  vi.spyOn(resultsService, 'fetchInboundCdrRows').mockImplementation(
    fetchInboundCdrRows,
  )
  vi.spyOn(resultsService, 'fetchQuestionResponseRows').mockImplementation(
    fetchQuestionResponseRows,
  )
  // Most tests run a pass several times inside one hour; the lock itself is
  // covered by its own describe below with the real service.
  const cronLock = service.app.get(CronLockService)
  vi.spyOn(cronLock, 'tryClaimHourlyRun').mockResolvedValue(true)
  vi.spyOn(cronLock, 'markHourlyCompleted').mockResolvedValue(undefined)

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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('OutreachInboundSweepService.sweepInboundEvents', () => {
  it('applies replies and reply-text opt-outs to exactly the matching rows, skipping duplicates and unknown phones', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      replyRow('13035550101'),
      // Same lead phone again — same synthetic event, applied once.
      replyRow('13035550101'),
      // A phone Peerly reports that was never on the captured list.
      replyRow('19995550999', 'STOP'),
      replyRow('13035550102', 'STOP'),
    ])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).toEqual(new Date('2026-07-17T10:23:46'))
    expect(person1.optedOutAt).toBeNull()
    expect(person1.sourceEventId).toBe(`peerly:${JOB_ID}:3035550101:reply`)

    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.respondedAt).toEqual(new Date('2026-07-17T10:23:46'))
    expect(person2.optedOutAt).toEqual(new Date('2026-07-17T10:23:46'))

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

  it('records an opt-out for a revocation phrase with no stop keyword on its own', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      replyRow('13035550101', 'Please stop texting me, thanks'),
    ])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).not.toBeNull()
    expect(person1.optedOutAt).not.toBeNull()
  })

  it('records no opt-out for an ordinary reply, even one using the word stop', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      replyRow('13035550101', 'Can you stop by the town hall on Friday?'),
    ])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).not.toBeNull()
    expect(person1.optedOutAt).toBeNull()
  })

  it('records no opt-out from a row whose Direction is neither sent nor received, and counts it', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      {
        ...replyRow('13035550101', 'Reply STOP to opt out'),
        Direction: 'queued',
      },
    ])
    const logSpy = loggerInfoSpy()

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).not.toBeNull()
    expect(person1.optedOutAt).toBeNull()
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ unexpectedDirectionRows: 1 }),
      expect.any(String),
    )
  })

  it('never requests the question-responses report', async () => {
    await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([replyRow('13035550101', 'STOP')])

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).toHaveBeenCalledTimes(1)
    expect(fetchQuestionResponseRows).not.toHaveBeenCalled()
  })

  it('stores midnight when a Peerly timestamp is date-only (yyyy-MM-dd)', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      { ...replyRow('13035550101'), Timestamp: '2026-07-17' },
      { ...replyRow('13035550102', 'STOP'), Timestamp: '2026-07-16' },
    ])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).toEqual(new Date('2026-07-17T00:00:00'))

    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.optedOutAt).toEqual(new Date('2026-07-16T00:00:00'))
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
    fetchInboundCdrRows.mockResolvedValue([replyRow('13035550101')])

    await sweepService.sweepInboundEvents()

    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.respondedAt).toEqual(firstReplyAt)
  })

  it('changes nothing when the sweep runs twice over the same events', async () => {
    const outreach = await createSweepableOutreach()
    fetchInboundCdrRows.mockResolvedValue([
      replyRow('13035550101'),
      replyRow('13035550102', 'STOP'),
    ])

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
    fetchInboundCdrRows.mockResolvedValue([replyRow('13035550101', 'STOP')])

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
    fetchInboundCdrRows.mockResolvedValue([replyRow('13035550103')])

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
    fetchInboundCdrRows.mockResolvedValue([replyRow('13035550101')])

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
    fetchInboundCdrRows.mockImplementation((jobId) =>
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

    expect(fetchInboundCdrRows).not.toHaveBeenCalled()
    expect(fetchQuestionResponseRows).not.toHaveBeenCalled()
  })

  it('still polls a completed-long-send outreach whose recent update keeps it inside the window', async () => {
    await createSweepableOutreach()

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).toHaveBeenCalledWith(
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

    expect(fetchInboundCdrRows).not.toHaveBeenCalled()
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

describe('OutreachInboundSweepService.sweepInboundEvents — cadence + in-flight guard', () => {
  // Fixed send anchor so the fresh/aged math below is deterministic
  // regardless of when the suite runs.
  const SEND_TIME = new Date('2026-07-01T00:00:00.000Z')
  const atHour = (date: Date, hours: number) =>
    set(date, { hours, minutes: 0, seconds: 0, milliseconds: 0 })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips a job whose send anchor is still in the future — no CDR can exist yet', async () => {
    const now = new Date('2026-07-10T13:00:00.000Z')
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, addDays(now, 3))
    const logSpy = loggerInfoSpy()

    vi.useFakeTimers({ now })

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsSkippedFuture: 1 }),
      expect.any(String),
    )
  })

  it('sweeps a fresh job every hourly pass, even on an hour not divisible by the aged interval', async () => {
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, SEND_TIME)

    // One day after send — inside the fresh window — at an hour that is
    // NOT a multiple of the aged interval.
    vi.useFakeTimers({ now: atHour(addDays(SEND_TIME, 1), 1) })

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).toHaveBeenCalledWith(JOB_ID, expect.anything())
  })

  it('skips an aged job outside its reduced-cadence hour, and sweeps it once that hour arrives', async () => {
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, SEND_TIME)
    const logSpy = loggerInfoSpy()

    // Past the fresh window, at an hour NOT divisible by the aged interval.
    const agedDate = addDays(SEND_TIME, INBOUND_SWEEP_FRESH_WINDOW_DAYS + 1)
    vi.useFakeTimers({ now: atHour(agedDate, 1) })

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsSkippedAgedCadence: 1 }),
      expect.any(String),
    )

    // Same aged job, an hour divisible by the aged interval — now sweeps.
    vi.setSystemTime(atHour(agedDate, INBOUND_SWEEP_AGED_HOUR_INTERVAL))

    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).toHaveBeenCalledWith(JOB_ID, expect.anything())
  })

  it('skips a job whose previous fetch is still in flight, and sweeps it again once that fetch resolves', async () => {
    await createSweepableOutreach()
    let resolveFirstFetch!: (rows: PeerlyCdrCsvRow[]) => void
    const firstFetch = new Promise<PeerlyCdrCsvRow[]>((resolve) => {
      resolveFirstFetch = resolve
    })
    fetchInboundCdrRows.mockReturnValueOnce(firstFetch)
    const logSpy = loggerInfoSpy()

    const firstPass = sweepService.sweepInboundEvents()
    await vi.waitFor(() => expect(fetchInboundCdrRows).toHaveBeenCalledTimes(1))

    // A second pass fires while the first job's fetch is still outstanding
    // — it must not issue a second concurrent report request for the job.
    await sweepService.sweepInboundEvents()
    expect(fetchInboundCdrRows).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsSkippedInFlight: 1 }),
      expect.any(String),
    )

    resolveFirstFetch([])
    await firstPass

    // The first pass's fetch has now resolved, so the job is no longer in
    // flight and the next pass polls it again.
    await sweepService.sweepInboundEvents()
    expect(fetchInboundCdrRows).toHaveBeenCalledTimes(2)
  })
})

describe('OutreachInboundSweepService — cron lock and deploy gate', () => {
  const NOW = new Date('2026-07-10T13:20:00.000Z')

  beforeEach(() => {
    const cronLock = service.app.get(CronLockService)
    vi.mocked(cronLock.tryClaimHourlyRun).mockRestore()
    vi.mocked(cronLock.markHourlyCompleted).mockRestore()
    // Only Date is faked so the claim and Prisma's own timers stay real.
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the hourly sweep once when two invocations land in the same slot', async () => {
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, subHours(NOW, 1))

    await sweepService.sweepInboundEvents()
    await sweepService.sweepInboundEvents()

    expect(fetchInboundCdrRows).toHaveBeenCalledTimes(1)
  })

  it('runs the opt-out reconcile once when two invocations land in the same slot', async () => {
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, subHours(NOW, 1))

    await sweepService.reconcileOptOutFlags()
    await sweepService.reconcileOptOutFlags()

    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a deploy outside dev and prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, subHours(NOW, 1))

    await sweepService.sweepInboundEvents()
    await sweepService.reconcileOptOutFlags()

    expect(fetchInboundCdrRows).not.toHaveBeenCalled()
    expect(fetchQuestionResponseRows).not.toHaveBeenCalled()
    expect(await service.prisma.cronRun.count()).toBe(0)
  })
})

describe('OutreachInboundSweepService.reconcileOptOutFlags', () => {
  it("applies Peerly's opt-out flags with one un-retried, long-timeout request per job", async () => {
    const outreach = await createSweepableOutreach()
    fetchQuestionResponseRows.mockResolvedValue([
      optOutRow('3035550102'),
      optOutRow('3035550101', '0'),
      // Common negations must read as NOT opted out even though the
      // vendor vocabulary is unverified — 'no' mass-writing optedOutAt
      // would corrupt the whole recipient list.
      optOutRow('3035550103', 'no'),
      optOutRow('3035550104', 'N'),
    ])

    await sweepService.reconcileOptOutFlags()

    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(1)
    expect(fetchQuestionResponseRows).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      { timeoutMs: 300000, retry: false },
    )
    expect(fetchInboundCdrRows).not.toHaveBeenCalled()

    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.optedOutAt).toEqual(new Date('2026-07-17T10:25:00'))
    expect(person2.respondedAt).toBeNull()
    expect(person2.sourceEventId).toBe(`peerly:${JOB_ID}:3035550102:optout`)

    for (const personId of ['person-1', 'person-3', 'person-4']) {
      const untouched = await findInteraction(outreach.id, personId)
      expect(untouched.optedOutAt).toBeNull()
    }
  })

  it('skips a flag already recorded from the reply text', async () => {
    const outreach = await createSweepableOutreach()
    // person-2 already replied, so the STOP reply cannot claim the row's one
    // sourceEventId slot and the opt-out id is stamped instead: the backup
    // pass then meets one opt-out by its id and the other by its timestamp.
    await service.prisma.contactInteractionText.update({
      where: {
        outreachId_personId: { outreachId: outreach.id, personId: 'person-2' },
      },
      data: { respondedAt: new Date('2026-07-16T00:00:00Z') },
    })
    fetchInboundCdrRows.mockResolvedValue([
      { ...replyRow('13035550101', 'STOP'), Timestamp: '2026-07-17 09:00:00' },
      { ...replyRow('13035550102', 'STOP'), Timestamp: '2026-07-17 09:05:00' },
    ])
    await sweepService.sweepInboundEvents()
    fetchQuestionResponseRows.mockResolvedValue([
      optOutRow('3035550101'),
      optOutRow('3035550102'),
    ])
    const logSpy = loggerInfoSpy()

    await sweepService.reconcileOptOutFlags()

    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        optOutsApplied: 0,
        skippedDuplicate: 1,
        skippedAlreadyApplied: 1,
      }),
      expect.any(String),
    )
    const person1 = await findInteraction(outreach.id, 'person-1')
    expect(person1.optedOutAt).toEqual(new Date('2026-07-17T09:00:00'))
    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.optedOutAt).toEqual(new Date('2026-07-17T09:05:00'))
  })

  it('moves on to the next job when one job times out', async () => {
    const SEND = new Date('2026-07-01T12:00:00.000Z')
    const older = await createSweepableOutreach({
      projectId: 'job-old',
      peerlyListId: 1111,
      recipients: [PERSON_1],
    })
    await setOutreachDate(older.id, SEND)
    const newer = await createSweepableOutreach({
      projectId: 'job-new',
      peerlyListId: 2222,
      recipients: [PERSON_2],
    })
    await setOutreachDate(newer.id, addDays(SEND, 1))
    fetchQuestionResponseRows.mockImplementation((jobId) =>
      jobId === 'job-new'
        ? Promise.reject(
            new GatewayTimeoutException('Timed out fetching Peerly report'),
          )
        : Promise.resolve([optOutRow('3035550101')]),
    )
    const logSpy = loggerInfoSpy()

    await expect(sweepService.reconcileOptOutFlags()).resolves.toBeUndefined()

    expect(
      fetchQuestionResponseRows.mock.calls.map(([jobId]) => jobId).sort(),
    ).toEqual(['job-new', 'job-old'])
    const person1 = await findInteraction(older.id, 'person-1')
    expect(person1.optedOutAt).not.toBeNull()
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jobsPolled: 1,
        jobsTimedOut: 1,
        jobsFailed: 0,
        optOutsApplied: 1,
      }),
      expect.any(String),
    )
  })

  it('records the exact instant from a report timestamp that carries an offset', async () => {
    const outreach = await createSweepableOutreach()
    fetchQuestionResponseRows.mockResolvedValue([
      { ...optOutRow('3035550102'), date: '2026-07-17 10:25:00 -0400' },
    ])

    await sweepService.reconcileOptOutFlags()

    const person2 = await findInteraction(outreach.id, 'person-2')
    expect(person2.optedOutAt).toEqual(new Date('2026-07-17T14:25:00.000Z'))
  })

  it('stamps every attempt, a timed-out one included, without moving outreach.updatedAt', async () => {
    const answered = await createSweepableOutreach({
      projectId: 'job-answered',
      peerlyListId: 1111,
      recipients: [PERSON_1],
    })
    const slow = await createSweepableOutreach({
      projectId: 'job-slow',
      peerlyListId: 2222,
      recipients: [PERSON_2],
    })
    const updatedAtBefore = await service.prisma.outreach.findMany({
      where: { id: { in: [answered.id, slow.id] } },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })
    fetchQuestionResponseRows.mockImplementation((jobId) =>
      jobId === 'job-slow'
        ? Promise.reject(
            new GatewayTimeoutException('Timed out fetching Peerly report'),
          )
        : Promise.resolve([]),
    )

    await sweepService.reconcileOptOutFlags()

    const stamps = await service.prisma.outreachOptOutReconcile.findMany({
      orderBy: { outreachId: 'asc' },
    })
    expect(stamps.map(({ outreachId }) => outreachId)).toEqual([
      answered.id,
      slow.id,
    ])
    const updatedAtAfter = await service.prisma.outreach.findMany({
      where: { id: { in: [answered.id, slow.id] } },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })
    expect(updatedAtAfter).toEqual(updatedAtBefore)
  })
})

describe('OutreachInboundSweepService.reconcileOptOutFlags — interval, window and budget', () => {
  const NOW = new Date('2026-07-10T13:45:00.000Z')

  beforeEach(() => {
    // Only Date is faked so p-map, Prisma and vi.waitFor keep real timers.
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createJob = async (projectId: string, peerlyListId: number) =>
    createSweepableOutreach({
      projectId,
      peerlyListId,
      recipients: [PERSON_1],
    })

  const calledJobIds = () =>
    fetchQuestionResponseRows.mock.calls.map(([jobId]) => jobId)

  it('reads a job again only once the interval has passed', async () => {
    const outreach = await createSweepableOutreach()
    await setOutreachDate(outreach.id, subHours(NOW, 1))
    const logSpy = loggerInfoSpy()

    await sweepService.reconcileOptOutFlags()
    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(1)

    vi.setSystemTime(addHours(NOW, OPT_OUT_RECONCILE_INTERVAL_HOURS - 1))
    await sweepService.reconcileOptOutFlags()
    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsDue: 0, jobsSkippedRecent: 1 }),
      expect.any(String),
    )

    // The sixth pass after, starting a moment earlier in its hour than the
    // pass that stamped the job.
    vi.setSystemTime(
      subSeconds(addHours(NOW, OPT_OUT_RECONCILE_INTERVAL_HOURS), 1),
    )
    await sweepService.reconcileOptOutFlags()
    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(2)
  })

  it('stamps a failed job and one with no captured list, so neither is retried before the interval', async () => {
    const failing = await createJob('job-failing', 1111)
    await setOutreachDate(failing.id, subHours(NOW, 1))
    const uncaptured = await createSweepableOutreach({
      projectId: 'job-uncaptured',
      peerlyListId: 2222,
      captureList: false,
    })
    await setOutreachDate(uncaptured.id, subHours(NOW, 1))
    fetchQuestionResponseRows.mockRejectedValue(
      new BadGatewayException('Failed to fetch Peerly report link'),
    )
    const logSpy = loggerInfoSpy()

    await sweepService.reconcileOptOutFlags()

    expect(calledJobIds()).toEqual(['job-failing'])
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsFailed: 1, jobsWithoutCapture: 1 }),
      expect.any(String),
    )
    const stamps = await service.prisma.outreachOptOutReconcile.findMany({
      orderBy: { outreachId: 'asc' },
    })
    expect(stamps).toEqual([
      { outreachId: failing.id, attemptedAt: NOW },
      { outreachId: uncaptured.id, attemptedAt: NOW },
    ])

    vi.setSystemTime(addHours(NOW, 1))
    await sweepService.reconcileOptOutFlags()
    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(1)
  })

  it('reads only sends inside the window, counting a recent update as inside', async () => {
    const outsideWindow = subDays(NOW, OPT_OUT_RECONCILE_WINDOW_DAYS + 1)
    const stale = await createJob('job-stale', 1111)
    await setOutreachDate(stale.id, outsideWindow)
    await setOutreachUpdatedAt(stale.id, outsideWindow)
    // A long send marked complete yesterday: its date is old, but people
    // were still being texted until it finished.
    const finishedLate = await createJob('job-finished-late', 2222)
    await setOutreachDate(finishedLate.id, outsideWindow)
    await setOutreachUpdatedAt(finishedLate.id, subDays(NOW, 1))

    await sweepService.reconcileOptOutFlags()

    expect(calledJobIds()).toEqual(['job-finished-late'])
  })

  it('starts no report once the budget is spent, and the next pass begins with the jobs it left', async () => {
    const newest = await createJob('job-newest', 1111)
    await setOutreachDate(newest.id, subHours(NOW, 1))
    const middle = await createJob('job-middle', 2222)
    await setOutreachDate(middle.id, subHours(NOW, 2))
    const oldest = await createJob('job-oldest', 3333)
    await setOutreachDate(oldest.id, subHours(NOW, 3))
    // Each report takes the whole budget: the two that start together both
    // run, and nothing starts after them.
    fetchQuestionResponseRows.mockImplementation(async () => {
      vi.setSystemTime(addMilliseconds(new Date(), OPT_OUT_RECONCILE_BUDGET_MS))
      return []
    })
    const logSpy = loggerInfoSpy()

    await sweepService.reconcileOptOutFlags()

    expect(calledJobIds().sort()).toEqual(['job-middle', 'job-newest'])
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsDue: 3, jobsPolled: 2, jobsDeferred: 1 }),
      expect.any(String),
    )
    expect(
      await service.prisma.outreachOptOutReconcile.findUnique({
        where: { outreachId: oldest.id },
      }),
    ).toBeNull()

    fetchQuestionResponseRows.mockClear()
    vi.setSystemTime(addHours(NOW, 1))
    await sweepService.reconcileOptOutFlags()

    expect(calledJobIds()).toEqual(['job-oldest'])
    expect(logSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobsPolled: 1, jobsSkippedRecent: 2 }),
      expect.any(String),
    )
  })

  it('reads a job no pass has reached before the one read longest ago', async () => {
    const neverRead = await createJob('job-never-read', 1111)
    await setOutreachDate(neverRead.id, subDays(NOW, 2))
    const readLongestAgo = await createJob('job-read-longest-ago', 2222)
    await setOutreachDate(readLongestAgo.id, subHours(NOW, 1))
    const readLater = await createJob('job-read-later', 3333)
    await setOutreachDate(readLater.id, subHours(NOW, 1))
    await service.prisma.outreachOptOutReconcile.createMany({
      data: [
        { outreachId: readLongestAgo.id, attemptedAt: subHours(NOW, 9) },
        { outreachId: readLater.id, attemptedAt: subHours(NOW, 7) },
      ],
    })
    fetchQuestionResponseRows.mockImplementation(async () => {
      vi.setSystemTime(addMilliseconds(new Date(), OPT_OUT_RECONCILE_BUDGET_MS))
      return []
    })

    await sweepService.reconcileOptOutFlags()

    expect(calledJobIds().sort()).toEqual([
      'job-never-read',
      'job-read-longest-ago',
    ])
  })

  it(`never has more than ${OPT_OUT_RECONCILE_CONCURRENCY} reports building at once`, async () => {
    for (const [index, projectId] of ['job-a', 'job-b', 'job-c'].entries()) {
      const outreach = await createJob(projectId, 1111 + index)
      await setOutreachDate(outreach.id, subHours(NOW, index + 1))
    }
    const pending: (() => void)[] = []
    fetchQuestionResponseRows.mockImplementation(
      () =>
        new Promise<PeerlyQuestionResponsesCsvRow[]>((resolve) => {
          pending.push(() => resolve([]))
        }),
    )

    const pass = sweepService.reconcileOptOutFlags()
    await vi.waitFor(
      () =>
        expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(
          OPT_OUT_RECONCILE_CONCURRENCY,
        ),
      { timeout: 5000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(
      OPT_OUT_RECONCILE_CONCURRENCY,
    )

    pending.shift()?.()
    await vi.waitFor(
      () => expect(fetchQuestionResponseRows).toHaveBeenCalledTimes(3),
      { timeout: 5000 },
    )
    while (pending.length > 0) pending.shift()?.()
    await pass
  })
})
