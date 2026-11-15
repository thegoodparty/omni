import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type OrdinanceQualityReport } from '@goodparty_org/contracts'
import { Ordinance, OrdinanceQualityLoopStatus } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { ORDINANCE_QUALITY_LOOP_ENABLED_ENV } from '../ordinances.constants'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from '../services/ordinanceQualityReport.service'
import { OrdinanceDraftRevisionService } from '../services/ordinanceDraftRevision.service'

const service = useTestService({ jobs: true })

const DRAFT_BODY = 'Section 34.21 Canopy goal of forty percent by 2040.'
const REVISED_BODY =
  'Section 34.21 Canopy goal. The city shall reach forty percent tree ' +
  'canopy cover by 2040, measured by the city forester each year.'

const CHECK_IDS = [
  'authority',
  'legal_conflict',
  'precedent_grounding',
  'completeness',
  'clarity',
  'voice',
] as const

const buildReport = (
  record: Ordinance,
  flaggedId?: string,
): OrdinanceQualityReport => {
  const checks = CHECK_IDS.map((id) => ({
    id,
    label: id,
    status: id === flaggedId ? ('flag' as const) : ('pass' as const),
    note: `Note for ${id}`,
  }))
  return {
    checks,
    tally: {
      pass: checks.filter((c) => c.status === 'pass').length,
      flag: checks.filter((c) => c.status === 'flag').length,
      attention: 0,
    },
    stale: false,
    ranAgainstBodyHash: qualityReportInputHash(record),
  }
}

const qcResult = (record: Ordinance, flaggedId?: string) => ({
  report: buildReport(record, flaggedId),
  degradedCheckIds: [],
  tokens: 100,
  inputTokens: 90,
  outputTokens: 10,
  model: 'claude-sonnet-4-6',
})

let orgSlug: string
let seq = 0

const header = () => ({ headers: { 'x-organization-slug': orgSlug } })

const startLoopOnDraft = async () => {
  const created = await service.client.post(
    '/v1/ordinances',
    { seedType: 'new', goalText: 'Tree canopy' },
    header(),
  )
  const { slug, id } = created.data
  await service.client.patch(
    `/v1/ordinances/${slug}`,
    {
      status: 'draft',
      draftTitle: 'Draft amendment to Chapter 34',
      draftBody: DRAFT_BODY,
    },
    header(),
  )
  const res = await service.client.post(
    `/v1/ordinances/${slug}/quality-loop`,
    {},
    header(),
  )
  expect(res.status).toBe(202)
  return id as string
}

const reload = (id: string) =>
  service.prisma.ordinance.findUniqueOrThrow({ where: { id } })

beforeEach(async () => {
  vi.stubEnv(ORDINANCE_QUALITY_LOOP_ENABLED_ENV, 'true')
  orgSlug = `eo-qloop-jobs-${Date.now()}-${seq++}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ordinanceQualityLoopStep', () => {
  it('runs qc, revise and qc as chained jobs until the draft converges', async () => {
    const generate = vi
      .spyOn(service.app.get(OrdinanceQualityReportService), 'generate')
      .mockImplementationOnce(async (record) => qcResult(record, 'clarity'))
      .mockImplementationOnce(async (record) => qcResult(record))
    vi.spyOn(
      service.app.get(OrdinanceDraftRevisionService),
      'revise',
    ).mockResolvedValue({
      title: 'Draft amendment to Chapter 34',
      body: REVISED_BODY,
      revisions: [{ checkId: 'clarity', note: 'Made the goal measurable' }],
      sourcesToAdd: [],
      tokens: 50,
      inputTokens: 40,
      outputTokens: 10,
      model: 'claude-sonnet-4-6',
    })

    const id = await startLoopOnDraft()
    await service.jobs.settle()

    const ordinance = await reload(id)
    expect(ordinance.qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.converged,
    )
    expect(ordinance.draftBody).toBe(REVISED_BODY)
    expect(ordinance.qualityLoopIteration).toBe(1)
    expect(generate).toHaveBeenCalledTimes(2)
    const iterations = await service.prisma.ordinanceQualityIteration.findMany({
      where: { ordinanceId: id },
    })
    expect(iterations).toHaveLength(2)
  })

  it('retries a step that lost a write race, then converges', async () => {
    const generate = vi
      .spyOn(service.app.get(OrdinanceQualityReportService), 'generate')
      .mockImplementationOnce(async (record) => {
        // Bumps updatedAt without touching the run, so the step's fenced
        // write misses and the job retries.
        await service.prisma.ordinance.update({
          where: { id: record.id },
          data: { lastViewedStep: 'draft' },
        })
        return qcResult(record)
      })
      .mockImplementationOnce(async (record) => qcResult(record))

    const id = await startLoopOnDraft()
    await service.jobs.settle()

    expect((await reload(id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.converged,
    )
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('fails the loop, without a dead letter, when the qc model call throws', async () => {
    vi.spyOn(
      service.app.get(OrdinanceQualityReportService),
      'generate',
    ).mockRejectedValue(new Error('provider down'))

    const id = await startLoopOnDraft()
    await service.jobs.settle()

    expect((await reload(id)).qualityLoopStatus).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
  })
})
