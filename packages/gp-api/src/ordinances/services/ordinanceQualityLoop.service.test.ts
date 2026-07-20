import { randomUUID } from 'node:crypto'
import { subMinutes } from 'date-fns'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { type OrdinanceQualityReport } from '@goodparty_org/contracts'
import {
  Ordinance,
  OrdinanceQualityLoopStatus,
  OrdinanceSeedType,
  OrdinanceStatus,
  Prisma,
} from '../../generated/prisma'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { FeaturesService } from 'src/features/services/features.service'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import {
  QueueType,
  type OrdinanceQualityLoopMessage,
} from 'src/queue/queue.types'
import { createMockLogger, firstOrThrow, nthOrThrow } from '@/shared/test-utils'
import { useTestService } from '@/test-service'
import {
  MAX_QUALITY_LOOP_REVISIONS,
  ORDINANCE_QUALITY_LOOP_ENABLED_ENV,
  SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
} from '../ordinances.constants'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from './ordinanceQualityReport.service'
import {
  OrdinanceDraftRevisionService,
  OrdinanceRevisionGuardError,
} from './ordinanceDraftRevision.service'
import { OrdinanceQualityLoopService } from './ordinanceQualityLoop.service'

const service = useTestService()

const COMPLETED_EVENT = 'Ordinances - Quality Loop Completed'

const DRAFT_BODY = [
  'Section 1. Definitions. Short-term rental means a dwelling unit rented',
  'for fewer than thirty consecutive days.',
  'Section 2. Permit required. No person shall operate a short-term rental',
  'without a permit issued by the city clerk.',
  'Section 3. Enforcement. Violations are punishable by a fine of up to',
  'five hundred dollars per day.',
].join('\n')

const REVISED_BODY = [
  'Section 1. Definitions. Short-term rental means a dwelling unit rented',
  'for fewer than thirty consecutive days to one party of guests.',
  'Section 2. Permit required. No person shall operate a short-term rental',
  'without an annual permit issued by the city clerk.',
  'Section 3. Enforcement. Violations are punishable by a fine of up to',
  'five hundred dollars per day, each day a separate offense.',
].join('\n')

const CHECK_IDS = [
  'authority',
  'legal_conflict',
  'precedent_grounding',
  'completeness',
  'clarity',
  'voice',
] as const

type CheckId = (typeof CHECK_IDS)[number]
type CheckStatus = 'pass' | 'flag' | 'attention'

const buildReport = (
  hash: string,
  statuses: Partial<Record<CheckId, CheckStatus>> = {},
): OrdinanceQualityReport => {
  const checks = CHECK_IDS.map((id) => ({
    id,
    label: id,
    status: statuses[id] ?? ('pass' as CheckStatus),
    note: `Actionable note for ${id}`,
  }))
  return {
    checks,
    tally: {
      pass: checks.filter((c) => c.status === 'pass').length,
      flag: checks.filter((c) => c.status === 'flag').length,
      attention: checks.filter((c) => c.status === 'attention').length,
    },
    stale: false,
    ranAgainstBodyHash: hash,
  }
}

let seq = 0

const seedOrdinance = async (
  overrides: Partial<Prisma.OrdinanceUncheckedCreateInput> = {},
) => {
  const slug = `qloop-org-${Date.now()}-${seq++}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const office = await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: slug },
  })
  return service.prisma.ordinance.create({
    data: {
      electedOfficeId: office.id,
      seedType: OrdinanceSeedType.new,
      status: OrdinanceStatus.draft,
      draftTitle: 'Short-term rental ordinance',
      draftBody: DRAFT_BODY,
      ...overrides,
    },
  })
}

const seedRunningLoop = async (
  runId: string,
  overrides: Partial<Prisma.OrdinanceUncheckedCreateInput> = {},
) =>
  seedOrdinance({
    qualityLoopStatus: OrdinanceQualityLoopStatus.running,
    qualityLoopRunId: runId,
    qualityLoopIteration: 0,
    qualityLoopUpdatedAt: new Date(),
    ...overrides,
  })

const seedIteration = (
  data: Omit<
    Prisma.OrdinanceQualityIterationUncheckedCreateInput,
    'draftTitle' | 'draftBody'
  > & { draftTitle?: string; draftBody?: string },
) =>
  service.prisma.ordinanceQualityIteration.create({
    data: {
      draftTitle: 'Short-term rental ordinance',
      draftBody: DRAFT_BODY,
      ...data,
    },
  })

const reload = (id: string) =>
  service.prisma.ordinance.findUniqueOrThrow({ where: { id } })

const iterationRows = (ordinanceId: string) =>
  service.prisma.ordinanceQualityIteration.findMany({
    where: { ordinanceId },
    orderBy: { iteration: Prisma.SortOrder.asc },
  })

const qcMessage = (
  ordinance: Ordinance,
  runId: string,
  overrides: Partial<OrdinanceQualityLoopMessage> = {},
): OrdinanceQualityLoopMessage => ({
  ordinanceId: ordinance.id,
  loopRunId: runId,
  iteration: 0,
  phase: 'qc',
  expectedInputHash: qualityReportInputHash(ordinance),
  attempt: 1,
  ...overrides,
})

let generateMock: Mock<OrdinanceQualityReportService['generate']>
let reviseMock: Mock<OrdinanceDraftRevisionService['revise']>
let sendMessageMock: Mock<QueueProducerService['sendMessage']>
let trackMock: Mock<AnalyticsService['track']>
let isFeatureEnabledMock: Mock<FeaturesService['isFeatureEnabled']>
let loop: OrdinanceQualityLoopService

beforeEach(() => {
  vi.stubEnv(ORDINANCE_QUALITY_LOOP_ENABLED_ENV, 'true')
  generateMock = vi.fn()
  reviseMock = vi.fn()
  sendMessageMock = vi.fn(async () => undefined)
  trackMock = vi.fn(async () => ({ event: 'test', userId: '1' }))
  isFeatureEnabledMock = vi.fn(async () => true)
  const features: Partial<FeaturesService> = {
    isFeatureEnabled: isFeatureEnabledMock,
  }
  const qualityReports: Partial<OrdinanceQualityReportService> = {
    generate: generateMock,
  }
  const revisions: Partial<OrdinanceDraftRevisionService> = {
    revise: reviseMock,
  }
  const producer: Partial<QueueProducerService> = {
    sendMessage: sendMessageMock,
  }
  const analytics: Partial<AnalyticsService> = { track: trackMock }
  loop = new OrdinanceQualityLoopService(
    features as FeaturesService,
    qualityReports as OrdinanceQualityReportService,
    revisions as OrdinanceDraftRevisionService,
    producer as QueueProducerService,
    analytics as AnalyticsService,
  )
  Object.defineProperty(loop, '_prisma', { get: () => service.prisma })
  Object.defineProperty(loop, 'logger', { value: createMockLogger() })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('start', () => {
  it('claims the loop and enqueues the first qc step', async () => {
    const ordinance = await seedOrdinance()

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'manual',
    })

    expect(result).toEqual({ started: true })
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.qualityLoopRunId).toBeTruthy()
    expect(updated.qualityLoopIteration).toBe(0)
    expect(updated.qualityLoopUpdatedAt).not.toBeNull()
    const runId = updated.qualityLoopRunId
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: ordinance.id,
          loopRunId: runId,
          iteration: 0,
          phase: 'qc',
          expectedInputHash: qualityReportInputHash(ordinance),
          attempt: 1,
        },
      },
      `ordinance-quality-loop-${ordinance.id}`,
      { throwOnError: true, deduplicationId: `${runId}:0:qc:1` },
    )
  })

  it('does not start when the feature flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    const ordinance = await seedOrdinance()

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'flag_off' })
    expect(isFeatureEnabledMock).toHaveBeenCalledWith({
      user: service.user.id,
      feature: SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
    })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBeNull()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('does not start when the env kill-switch is off', async () => {
    vi.stubEnv(ORDINANCE_QUALITY_LOOP_ENABLED_ENV, 'false')
    const ordinance = await seedOrdinance()

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'env_off' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBeNull()
  })

  it('reports already_running on a manual trigger over a live loop', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'manual',
    })

    expect(result).toEqual({ started: false, reason: 'already_running' })
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.qualityLoopRunId).toBe(runId)
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('auto trigger retires the running loop when a redline declines', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      draftBody: 'Section 1. {-old text-}{+new text+} remains.',
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'redline_draft' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('auto trigger retires the running loop when the env is off', async () => {
    vi.stubEnv(ORDINANCE_QUALITY_LOOP_ENABLED_ENV, 'false')
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'env_off' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
  })

  it('auto trigger retires the running loop when the flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'flag_off' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
  })

  it('auto trigger retires the running loop when already passing', async () => {
    const runId = randomUUID()
    const seeded = await seedRunningLoop(runId)
    const passing = buildReport(qualityReportInputHash(seeded))
    const ordinance = await service.prisma.ordinance.update({
      where: { id: seeded.id },
      data: { qualityReport: passing },
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'already_passing' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
  })

  it('auto trigger supersedes the running loop and claims a new run', async () => {
    const oldRunId = randomUUID()
    const ordinance = await seedRunningLoop(oldRunId, {
      qualityLoopIteration: 2,
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: true })
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.qualityLoopRunId).not.toBe(oldRunId)
    expect(updated.qualityLoopIteration).toBe(0)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('a live manual QC run blocks a loop start', async () => {
    const ordinance = await seedOrdinance({
      qualityRunStatus: 'running',
      qualityRunStartedAt: new Date(),
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'manual',
    })

    expect(result).toEqual({ started: false, reason: 'manual_run_active' })
    expect((await reload(ordinance.id)).qualityLoopStatus).toBeNull()
  })

  it('a stale manual QC claim does not block a loop start', async () => {
    const ordinance = await seedOrdinance({
      qualityRunStatus: 'running',
      qualityRunStartedAt: subMinutes(new Date(), 20),
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'manual',
    })

    expect(result).toEqual({ started: true })
  })

  it('skips when the current report already passes for the current hash', async () => {
    const seeded = await seedOrdinance()
    const passing = buildReport(qualityReportInputHash(seeded))
    const ordinance = await service.prisma.ordinance.update({
      where: { id: seeded.id },
      data: { qualityReport: passing },
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'already_passing' })
  })

  it('skips an ordinance advanced beyond draft', async () => {
    const ordinance = await seedOrdinance({
      status: OrdinanceStatus.in_review,
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'status_beyond_draft' })
  })

  it('skips a redline draft', async () => {
    const ordinance = await seedOrdinance({
      draftBody: 'Section 1. {-old text-}{+new text+} remains.',
    })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'redline_draft' })
  })

  it('skips an empty draft', async () => {
    const ordinance = await seedOrdinance({ draftBody: '   ' })

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'auto',
    })

    expect(result).toEqual({ started: false, reason: 'empty_draft' })
  })

  it('flips the claim to failed when the enqueue throws', async () => {
    sendMessageMock.mockRejectedValue(new Error('sqs down'))
    const ordinance = await seedOrdinance()

    const result = await loop.start({
      ordinance,
      userId: service.user.id,
      trigger: 'manual',
    })

    expect(result).toEqual({ started: false, reason: 'enqueue_failed' })
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.failed)
  })
})

describe('handleStep receipt guards', () => {
  it('ack-drops a message for a missing ordinance', async () => {
    const result = await loop.handleStep({
      ordinanceId: randomUUID(),
      loopRunId: randomUUID(),
      iteration: 0,
      phase: 'qc',
      expectedInputHash: 'x',
      attempt: 1,
    })

    expect(result).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('ack-drops a message whose runId does not match', async () => {
    const ordinance = await seedRunningLoop(randomUUID())

    const result = await loop.handleStep(qcMessage(ordinance, randomUUID()))

    expect(result).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('ack-drops a message for a loop no longer running', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopStatus: OrdinanceQualityLoopStatus.cancelled,
    })

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
  })
})

describe('handleStep qc', () => {
  it('persists the report and iteration row, then enqueues revise', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        clarity: 'flag',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    const stored = updated.qualityReport as OrdinanceQualityReport
    expect(stored.tally.flag).toBe(1)
    const rows = await iterationRows(ordinance.id)
    expect(rows).toHaveLength(1)
    const row = firstOrThrow(rows)
    expect(row.iteration).toBe(0)
    expect(row.qcAttempts).toBe(1)
    expect(row.draftBody).toBe(DRAFT_BODY)
    expect(row.inputHash).toBe(qualityReportInputHash(ordinance))
    expect(row.report).not.toBeNull()
    expect(row.tokens).toBe(111)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: ordinance.id,
          loopRunId: runId,
          iteration: 0,
          phase: 'revise',
          expectedInputHash: qualityReportInputHash(ordinance),
          attempt: 1,
        },
      },
      `ordinance-quality-loop-${ordinance.id}`,
      { throwOnError: true, deduplicationId: `${runId}:0:revise:1` },
    )
  })

  it('converges when no checks flag and fires the completion event', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        voice: 'attention',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.converged)
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(trackMock).toHaveBeenCalledWith(
      service.user.id,
      COMPLETED_EVENT,
      expect.objectContaining({
        status: OrdinanceQualityLoopStatus.converged,
        iterations: 1,
        flagsAfter: 0,
        attentionAfter: 1,
        restoredIteration: null,
        totalTokens: 111,
      }),
    )
  })

  it('discards the result when the loop is cancelled mid-LLM', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockImplementation(async (record: Ordinance) => {
      await loop.cancel(record.id)
      return {
        report: buildReport(qualityReportInputHash(record), {
          clarity: 'flag',
        }),
        degradedCheckIds: [],
        tokens: 111,
      }
    })

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.cancelled)
    expect(updated.qualityReport).toBeNull()
    expect(await iterationRows(ordinance.id)).toHaveLength(0)
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('redelivers when a non-superseding write bumps updatedAt mid-qc', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockImplementation(async (record: Ordinance) => {
      // Any Ordinance update bumps @updatedAt; this one changes neither the
      // loop's ownership nor its graded inputs, so the step must retry via
      // redelivery instead of stranding the loop as a zombie 'running' row.
      await service.prisma.ordinance.update({
        where: { id: record.id },
        data: { lastViewedStep: 'draft' },
      })
      return {
        report: buildReport(qualityReportInputHash(record), {
          clarity: 'flag',
        }),
        degradedCheckIds: [],
        tokens: 111,
      }
    })

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(false)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.qualityLoopRunId).toBe(runId)
    expect(updated.qualityReport).toBeNull()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('supersedes when the frontier step sees a changed input hash', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { expectedInputHash: 'stale-hash' }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('re-enqueues the frontier step for a behind-frontier message', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'orig-hash',
      report: buildReport('orig-hash', { clarity: 'flag' }),
      revisedTitle: 'Revised title',
      revisedBody: REVISED_BODY,
      revisedInputHash: 'revised-hash-1',
      revisionNotes: [{ checkId: 'clarity', note: 'Tightened' }],
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, {
        iteration: 0,
        expectedInputHash: 'orig-hash',
      }),
    )

    expect(result).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.running,
    )
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: ordinance.id,
          loopRunId: runId,
          iteration: 1,
          phase: 'qc',
          expectedInputHash: 'revised-hash-1',
          attempt: 1,
        },
      },
      `ordinance-quality-loop-${ordinance.id}`,
      { throwOnError: true, deduplicationId: `${runId}:1:qc:1` },
    )
  })

  it('never supersedes on a duplicate revise message behind the frontier', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'orig-hash',
      report: buildReport('orig-hash', { clarity: 'flag' }),
      revisedTitle: 'Revised title',
      revisedBody: REVISED_BODY,
      revisedInputHash: 'revised-hash-1',
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, {
        iteration: 0,
        phase: 'revise',
        // Matches the graded (pre-revision) inputs, not the current record,
        // which is exactly the state that used to trigger a false supersede.
        expectedInputHash: 'orig-hash',
      }),
    )

    expect(result).toBe(true)
    expect(reviseMock).not.toHaveBeenCalled()
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('skips the LLM for a redelivered frontier qc whose report persisted', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    const hash = qualityReportInputHash(ordinance)
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: hash,
      report: buildReport(hash, { clarity: 'flag' }),
    })

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: expect.objectContaining({ phase: 'revise', iteration: 0 }),
      },
      `ordinance-quality-loop-${ordinance.id}`,
      expect.objectContaining({ throwOnError: true }),
    )
  })

  it('retries a degraded qc from DB state, then fails at attempt two', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        clarity: 'attention',
      }),
      degradedCheckIds: ['clarity'],
      tokens: 40,
    }))

    const first = await loop.handleStep(qcMessage(ordinance, runId))

    expect(first).toBe(true)
    const afterFirst = await reload(ordinance.id)
    expect(afterFirst.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.running,
    )
    expect(afterFirst.qualityReport).toBeNull()
    const rows = await iterationRows(ordinance.id)
    expect(rows).toHaveLength(1)
    expect(firstOrThrow(rows).qcAttempts).toBe(1)
    expect(firstOrThrow(rows).report).toBeNull()
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: ordinance.id,
          loopRunId: runId,
          iteration: 0,
          phase: 'qc',
          expectedInputHash: qualityReportInputHash(ordinance),
          attempt: 2,
        },
      },
      `ordinance-quality-loop-${ordinance.id}`,
      { throwOnError: true, deduplicationId: `${runId}:0:qc:2` },
    )

    // The message's attempt field is deliberately wrong: the handler must
    // read the authoritative attempt count from the iteration row.
    const second = await loop.handleStep(
      qcMessage(ordinance, runId, { attempt: 7 }),
    )

    expect(second).toBe(true)
    const afterSecond = await reload(ordinance.id)
    expect(afterSecond.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
    expect(afterSecond.qualityReport).toBeNull()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('fails the loop when the qc LLM call throws', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId)
    generateMock.mockRejectedValue(new Error('provider down'))

    const result = await loop.handleStep(qcMessage(ordinance, runId))

    expect(result).toBe(true)
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
  })

  it('stops at max iterations and restores the best iteration', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: MAX_QUALITY_LOOP_REVISIONS,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      draftTitle: 'v0 title',
      draftBody: 'v0 body of the ordinance draft',
      report: buildReport('h0', { clarity: 'flag', voice: 'flag' }),
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: 'h1',
      draftTitle: 'v1 title',
      draftBody: 'v1 body of the ordinance draft',
      report: buildReport('h1', {
        clarity: 'flag',
        voice: 'attention',
        completeness: 'attention',
      }),
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 2,
      inputHash: 'h2',
      draftTitle: 'v2 title',
      draftBody: 'v2 body of the ordinance draft',
      report: buildReport('h2', { clarity: 'flag', voice: 'attention' }),
    })
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        clarity: 'flag',
        voice: 'flag',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, {
        iteration: MAX_QUALITY_LOOP_REVISIONS,
      }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.stopped_max_iterations,
    )
    // Iteration 2 has the fewest flags (tie with 1 broken by fewer
    // attentions), so its graded draft and report are restored.
    expect(updated.draftTitle).toBe('v2 title')
    expect(updated.draftBody).toBe('v2 body of the ordinance draft')
    const stored = updated.qualityReport as OrdinanceQualityReport
    expect(stored.ranAgainstBodyHash).toBe('h2')
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(trackMock).toHaveBeenCalledWith(
      service.user.id,
      COMPLETED_EVENT,
      expect.objectContaining({
        status: OrdinanceQualityLoopStatus.stopped_max_iterations,
        restoredIteration: 2,
      }),
    )
  })

  it('counts flag-to-attention as resolved and keeps looping', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      report: buildReport('h0', {
        completeness: 'flag',
        clarity: 'flag',
      }),
    })
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        completeness: 'attention',
        clarity: 'flag',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { iteration: 1 }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: expect.objectContaining({ phase: 'revise', iteration: 1 }),
      },
      `ordinance-quality-loop-${ordinance.id}`,
      expect.objectContaining({ throwOnError: true }),
    )
  })

  it('stops as not improving when the flag set does not shrink', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      draftTitle: 'v0 title',
      draftBody: 'v0 body of the ordinance draft',
      report: buildReport('h0', { clarity: 'flag' }),
    })
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        clarity: 'flag',
        voice: 'attention',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { iteration: 1 }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.stopped_not_improving,
    )
    // Both iterations flag one check; iteration 0 has fewer attentions, so
    // its draft is restored.
    expect(updated.draftTitle).toBe('v0 title')
    expect(updated.draftBody).toBe('v0 body of the ordinance draft')
    expect(trackMock).toHaveBeenCalledWith(
      service.user.id,
      COMPLETED_EVENT,
      expect.objectContaining({
        status: OrdinanceQualityLoopStatus.stopped_not_improving,
        restoredIteration: 0,
      }),
    )
  })

  it('stops as not improving when a new flag appears in a smaller set', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      report: buildReport('h0', {
        completeness: 'flag',
        clarity: 'flag',
      }),
    })
    // Fewer flags than iteration 0, but voice is NEW — a regression, not an
    // improvement, so the proper-subset rule must stop the loop.
    generateMock.mockImplementation(async (record: Ordinance) => ({
      report: buildReport(qualityReportInputHash(record), {
        voice: 'flag',
      }),
      degradedCheckIds: [],
      tokens: 111,
    }))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { iteration: 1 }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.stopped_not_improving,
    )
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(trackMock).toHaveBeenCalledWith(
      service.user.id,
      COMPLETED_EVENT,
      expect.objectContaining({
        status: OrdinanceQualityLoopStatus.stopped_not_improving,
        restoredIteration: 1,
      }),
    )
  })
})

describe('handleStep terminal writes vs a changed draft', () => {
  const NEW_DRAFT_TITLE = 'User rewritten title'
  const NEW_DRAFT_BODY = 'Section 1. The user rewrote this after grading.'

  // Prisma delegate methods return a branded PrismaPromise; wrapped mock
  // implementations must re-brand or the spy's signature rejects them.
  // defineProperty, not assignment: Promise.prototype's toStringTag is
  // read-only, so assigning through it throws.
  const prismaPromise = <T>(promise: Promise<T>) => {
    Object.defineProperty(promise, Symbol.toStringTag, {
      value: 'PrismaPromise',
    })
    return promise as Promise<T> & { [Symbol.toStringTag]: 'PrismaPromise' }
  }

  // Intercepts the loop's own terminal flip to land a competing draft write
  // just before it — the saveDraft race, at its tightest window.
  const raceDraftSaveBeforeFlip = (
    ordinanceId: string,
    status: OrdinanceQualityLoopStatus,
  ) => {
    const delegate = service.prisma.ordinance
    const original = delegate.updateMany.bind(delegate)
    const spy = vi.spyOn(delegate, 'updateMany').mockImplementation((args) =>
      prismaPromise(
        (async () => {
          if (args.data.qualityLoopStatus === status) {
            await service.prisma.ordinance.update({
              where: { id: ordinanceId },
              data: { draftTitle: NEW_DRAFT_TITLE, draftBody: NEW_DRAFT_BODY },
            })
          }
          return original(args)
        })(),
      ),
    )
    return spy
  }

  it('supersedes instead of restoring over a draft edited after the frontier qc persisted', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftTitle: NEW_DRAFT_TITLE,
      draftBody: NEW_DRAFT_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      draftTitle: 'v0 title',
      draftBody: 'v0 body of the ordinance draft',
      report: buildReport('h0', { clarity: 'flag' }),
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: 'h1',
      draftTitle: 'v1 title',
      draftBody: 'v1 body of the ordinance draft',
      report: buildReport('h1', { clarity: 'flag', voice: 'flag' }),
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { iteration: 1 }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(updated.draftTitle).toBe(NEW_DRAFT_TITLE)
    expect(updated.draftBody).toBe(NEW_DRAFT_BODY)
    expect(generateMock).not.toHaveBeenCalled()
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(trackMock).toHaveBeenCalledWith(
      service.user.id,
      COMPLETED_EVENT,
      expect.objectContaining({
        status: OrdinanceQualityLoopStatus.superseded_by_edit,
      }),
    )
  })

  it('supersedes instead of stamping converged on a draft edited after grading', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftTitle: NEW_DRAFT_TITLE,
      draftBody: NEW_DRAFT_BODY,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: 'h1',
      draftTitle: 'v1 title',
      draftBody: 'v1 body of the ordinance draft',
      report: buildReport('h1'),
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { iteration: 1 }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(updated.draftTitle).toBe(NEW_DRAFT_TITLE)
    expect(updated.draftBody).toBe(NEW_DRAFT_BODY)
  })

  it('yields to a saveDraft that lands during the terminal restore', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    const gradedHash = qualityReportInputHash(ordinance)
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      draftTitle: 'v0 title',
      draftBody: 'v0 body of the ordinance draft',
      report: buildReport('h0', { clarity: 'flag' }),
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: gradedHash,
      draftBody: REVISED_BODY,
      report: buildReport(gradedHash, { clarity: 'flag', voice: 'flag' }),
    })
    const spy = raceDraftSaveBeforeFlip(
      ordinance.id,
      OrdinanceQualityLoopStatus.stopped_not_improving,
    )
    try {
      const result = await loop.handleStep(
        qcMessage(ordinance, runId, { iteration: 1 }),
      )

      expect(result).toBe(true)
    } finally {
      spy.mockRestore()
    }
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(updated.draftTitle).toBe(NEW_DRAFT_TITLE)
    expect(updated.draftBody).toBe(NEW_DRAFT_BODY)
  })

  it('yields to a saveDraft that lands during the converged flip', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
      draftBody: REVISED_BODY,
    })
    const gradedHash = qualityReportInputHash(ordinance)
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: gradedHash,
      draftBody: REVISED_BODY,
      report: buildReport(gradedHash),
    })
    const spy = raceDraftSaveBeforeFlip(
      ordinance.id,
      OrdinanceQualityLoopStatus.converged,
    )
    try {
      const result = await loop.handleStep(
        qcMessage(ordinance, runId, { iteration: 1 }),
      )

      expect(result).toBe(true)
    } finally {
      spy.mockRestore()
    }
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect(updated.draftTitle).toBe(NEW_DRAFT_TITLE)
    expect(updated.draftBody).toBe(NEW_DRAFT_BODY)
  })
})

describe('handleStep revise', () => {
  const seedReviseReady = async (runId: string) => {
    const ordinance = await seedRunningLoop(runId)
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: qualityReportInputHash(ordinance),
      report: buildReport(qualityReportInputHash(ordinance), {
        clarity: 'flag',
      }),
    })
    return ordinance
  }

  const revision = {
    title: 'Revised title',
    body: REVISED_BODY,
    revisions: [{ checkId: 'clarity', note: 'Tightened definitions' }],
    sourcesToAdd: [{ id: 'cmp-1', title: 'Austin STR ordinance' }],
    tokens: 20,
  }

  it('applies the revision, bumps the frontier, and enqueues the next qc', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockResolvedValue(revision)

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.draftTitle).toBe('Revised title')
    expect(updated.draftBody).toBe(REVISED_BODY)
    expect(updated.qualityLoopIteration).toBe(1)
    expect(updated.draftSources).toEqual([
      { id: 'cmp-1', title: 'Austin STR ordinance' },
    ])
    const revisedHash = qualityReportInputHash({
      ...ordinance,
      draftTitle: 'Revised title',
      draftBody: REVISED_BODY,
    })
    const rows = await iterationRows(ordinance.id)
    const revisedRow = firstOrThrow(rows)
    expect(revisedRow.revisedTitle).toBe('Revised title')
    expect(revisedRow.revisedBody).toBe(REVISED_BODY)
    expect(revisedRow.revisedInputHash).toBe(revisedHash)
    expect(revisedRow.revisionNotes).toEqual([
      { checkId: 'clarity', note: 'Tightened definitions' },
    ])
    expect(revisedRow.tokens).toBe(20)
    const [, flaggedArg] = firstOrThrow(reviseMock.mock.calls)
    expect(flaggedArg.map((check) => check.id)).toEqual(['clarity'])
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: {
          ordinanceId: ordinance.id,
          loopRunId: runId,
          iteration: 1,
          phase: 'qc',
          expectedInputHash: revisedHash,
          attempt: 1,
        },
      },
      `ordinance-quality-loop-${ordinance.id}`,
      { throwOnError: true, deduplicationId: `${runId}:1:qc:1` },
    )
  })

  it('retries once on a guard error and applies the second result', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock
      .mockRejectedValueOnce(new OrdinanceRevisionGuardError('gutted'))
      .mockResolvedValueOnce(revision)

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    expect(reviseMock).toHaveBeenCalledTimes(2)
    const updated = await reload(ordinance.id)
    expect(updated.draftBody).toBe(REVISED_BODY)
    expect(updated.qualityLoopIteration).toBe(1)
  })

  it('shares one step abort budget across the guard retry', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock
      .mockRejectedValueOnce(new OrdinanceRevisionGuardError('gutted'))
      .mockResolvedValueOnce(revision)

    await loop.handleStep(qcMessage(ordinance, runId, { phase: 'revise' }))

    // A fresh timeout per attempt would let one message run ~480s of LLM
    // time, breaching the 300s SQS visibility window; the retry must spend
    // only what remains of the step's single budget.
    expect(reviseMock).toHaveBeenCalledTimes(2)
    const [, , firstOpts] = firstOrThrow(reviseMock.mock.calls)
    const [, , secondOpts] = nthOrThrow(reviseMock.mock.calls, 1)
    expect(firstOpts?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(secondOpts?.abortSignal).toBe(firstOpts?.abortSignal)
  })

  it('redelivers when a non-superseding write bumps updatedAt mid-revise', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockImplementation(async () => {
      await service.prisma.ordinance.update({
        where: { id: ordinance.id },
        data: { lastViewedStep: 'draft' },
      })
      return revision
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(false)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.running)
    expect(updated.qualityLoopRunId).toBe(runId)
    expect(updated.draftBody).toBe(DRAFT_BODY)
    expect(updated.qualityLoopIteration).toBe(0)
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('enqueues the next qc when a twin already applied the revision', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockImplementation(async () => {
      // A visibility-timeout twin lands the same revision first: frontier
      // advances, the row records the revised hash, ownership stays ours.
      await service.prisma.ordinance.update({
        where: { id: ordinance.id },
        data: {
          draftTitle: 'Revised title',
          draftBody: REVISED_BODY,
          qualityLoopIteration: 1,
        },
      })
      await service.prisma.ordinanceQualityIteration.updateMany({
        where: { ordinanceId: ordinance.id, loopRunId: runId, iteration: 0 },
        data: { revisedInputHash: 'twin-hash' },
      })
      return revision
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.running,
    )
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      {
        type: QueueType.ORDINANCE_QUALITY_LOOP,
        data: expect.objectContaining({
          phase: 'qc',
          iteration: 1,
          expectedInputHash: 'twin-hash',
        }),
      },
      `ordinance-quality-loop-${ordinance.id}`,
      expect.objectContaining({ throwOnError: true }),
    )
  })

  it('fails the loop when the guard rejects twice', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockRejectedValue(new OrdinanceRevisionGuardError('gutted'))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    expect(reviseMock).toHaveBeenCalledTimes(2)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.failed)
    expect(updated.draftBody).toBe(DRAFT_BODY)
  })

  it('fails the loop when the revise LLM call throws', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockRejectedValue(new Error('provider down'))

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    expect(reviseMock).toHaveBeenCalledTimes(1)
    expect((await reload(ordinance.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
  })

  it('discards the revision when the loop is cancelled mid-LLM', async () => {
    const runId = randomUUID()
    const ordinance = await seedReviseReady(runId)
    reviseMock.mockImplementation(async () => {
      await loop.cancel(ordinance.id)
      return revision
    })

    const result = await loop.handleStep(
      qcMessage(ordinance, runId, { phase: 'revise' }),
    )

    expect(result).toBe(true)
    const updated = await reload(ordinance.id)
    expect(updated.qualityLoopStatus).toBe(OrdinanceQualityLoopStatus.cancelled)
    expect(updated.draftBody).toBe(DRAFT_BODY)
    expect(updated.qualityLoopIteration).toBe(0)
    const rows = await iterationRows(ordinance.id)
    expect(firstOrThrow(rows).revisedTitle).toBeNull()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })
})

describe('cancel and supersedeOnEdit', () => {
  it('cancel flips a running loop and preserves terminal states', async () => {
    const running = await seedRunningLoop(randomUUID())
    const converged = await seedRunningLoop(randomUUID(), {
      qualityLoopStatus: OrdinanceQualityLoopStatus.converged,
    })

    await loop.cancel(running.id)
    await loop.cancel(converged.id)

    expect((await reload(running.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.cancelled,
    )
    expect((await reload(converged.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.converged,
    )
  })

  it('supersedeOnEdit flips only a running loop', async () => {
    const running = await seedRunningLoop(randomUUID())
    const failed = await seedRunningLoop(randomUUID(), {
      qualityLoopStatus: OrdinanceQualityLoopStatus.failed,
    })

    await loop.supersedeOnEdit(running.id)
    await loop.supersedeOnEdit(failed.id)

    expect((await reload(running.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.superseded_by_edit,
    )
    expect((await reload(failed.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
  })
})

describe('sweepStalled', () => {
  it('flips only stale running loops to failed', async () => {
    const stale = await seedRunningLoop(randomUUID(), {
      qualityLoopUpdatedAt: subMinutes(new Date(), 45),
    })
    const fresh = await seedRunningLoop(randomUUID())
    const terminal = await seedRunningLoop(randomUUID(), {
      qualityLoopStatus: OrdinanceQualityLoopStatus.converged,
      qualityLoopUpdatedAt: subMinutes(new Date(), 45),
    })

    await loop.sweepStalled()

    expect((await reload(stale.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
    expect((await reload(fresh.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.running,
    )
    expect((await reload(terminal.id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.converged,
    )
  })
})

describe('listIterations', () => {
  it('returns the latest run rows with flagged check ids', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 0,
      inputHash: 'h0',
      report: buildReport('h0', { clarity: 'flag' }),
      revisedTitle: 'Revised title',
      revisedBody: REVISED_BODY,
      revisedInputHash: 'h1',
      revisionNotes: [{ checkId: 'clarity', note: 'Tightened' }],
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: 'h1',
      report: buildReport('h1'),
    })
    await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: 'some-older-run',
      iteration: 0,
      inputHash: 'old',
      report: buildReport('old'),
    })

    const result = await loop.listIterations(ordinance.id)

    expect(result.loopRunId).toBe(runId)
    expect(result.iterations).toHaveLength(2)
    const first = firstOrThrow(result.iterations)
    expect(first.iteration).toBe(0)
    expect(first.flaggedCheckIds).toEqual(['clarity'])
    expect(first.revisedTitle).toBe('Revised title')
    expect(first.revisionNotes).toEqual([
      { checkId: 'clarity', note: 'Tightened' },
    ])
    const second = nthOrThrow(result.iterations, 1)
    expect(second.flaggedCheckIds).toEqual([])
    expect(second.revisedTitle).toBeNull()
  })

  it('returns an empty response when no loop ever ran', async () => {
    const ordinance = await seedOrdinance()

    const result = await loop.listIterations(ordinance.id)

    expect(result).toEqual({ loopRunId: null, iterations: [] })
  })
})

describe('qualityLoopForResponse', () => {
  it('is null when no loop state exists', async () => {
    const ordinance = await seedOrdinance()

    expect(loop.qualityLoopForResponse(ordinance)).toBeNull()
  })

  it('derives checking phase and display-ready pass numbers', async () => {
    const ordinance = await seedRunningLoop(randomUUID())

    expect(loop.qualityLoopForResponse(ordinance)).toEqual({
      status: OrdinanceQualityLoopStatus.running,
      phase: 'checking',
      passNumber: 1,
      maxPasses: MAX_QUALITY_LOOP_REVISIONS + 1,
      updatedAt: ordinance.qualityLoopUpdatedAt?.toISOString(),
    })
  })

  it('derives revising phase when the frontier iteration has a report', async () => {
    const runId = randomUUID()
    const ordinance = await seedRunningLoop(runId, {
      qualityLoopIteration: 1,
    })
    const row = await seedIteration({
      ordinanceId: ordinance.id,
      loopRunId: runId,
      iteration: 1,
      inputHash: 'h1',
      report: buildReport('h1', { clarity: 'flag' }),
    })

    const result = loop.qualityLoopForResponse({
      ...ordinance,
      latestIteration: row,
    })

    expect(result?.phase).toBe('revising')
    expect(result?.passNumber).toBe(2)
  })

  it('has a null phase on terminal states', async () => {
    const ordinance = await seedRunningLoop(randomUUID(), {
      qualityLoopStatus: OrdinanceQualityLoopStatus.converged,
    })

    expect(loop.qualityLoopForResponse(ordinance)?.phase).toBeNull()
  })
})
