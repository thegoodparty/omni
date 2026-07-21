import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type OrdinanceQualityReport } from '@goodparty_org/contracts'
import { OrdinanceQualityLoopStatus } from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { useTestService } from '@/test-service'
import {
  ORDINANCE_QUALITY_LOOP_ENABLED_ENV,
  SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
} from '../ordinances.constants'

const service = useTestService()

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedDraftOrdinance = async (header: ReturnType<typeof orgHeader>) => {
  const created = await service.client.post(
    '/v1/ordinances',
    { seedType: 'new', goalText: 'Tree canopy' },
    header,
  )
  const { slug, id } = created.data
  await service.client.patch(
    `/v1/ordinances/${slug}`,
    {
      status: 'draft',
      draftTitle: 'Draft amendment to Chapter 34',
      draftBody: 'Section 34.21 Canopy goal of forty percent by 2040.',
    },
    header,
  )
  return { slug: slug as string, id: id as string }
}

const CHECK_IDS = [
  'authority',
  'legal_conflict',
  'precedent_grounding',
  'completeness',
  'clarity',
  'voice',
] as const

const buildReport = (flaggedId?: string): OrdinanceQualityReport => {
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
    ranAgainstBodyHash: 'hash-0',
  }
}

const startLoop = (slug: string, header: ReturnType<typeof orgHeader>) =>
  service.client.post(`/v1/ordinances/${slug}/quality-loop`, {}, header)

beforeEach(() => {
  vi.stubEnv(ORDINANCE_QUALITY_LOOP_ENABLED_ENV, 'true')
  vi.spyOn(
    service.app.get(QueueProducerService),
    'sendMessage',
  ).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /v1/ordinances/:slug/quality-loop', () => {
  it('starts a loop with 202, running loop state, and one enqueued step', async () => {
    const orgSlug = 'eo-qloop-start'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)

    const res = await startLoop(slug, header)

    expect(res.status).toBe(202)
    expect(res.data.qualityLoop).toEqual({
      status: 'running',
      phase: 'checking',
      passNumber: 1,
      maxPasses: 4,
      updatedAt: expect.any(String),
    })
    const producer = service.app.get(QueueProducerService)
    expect(producer.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('409s a second start while the loop is running', async () => {
    const orgSlug = 'eo-qloop-conflict'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)

    await startLoop(slug, header)
    const second = await startLoop(slug, header)

    expect(second.status).toBe(409)
  })

  it('403s when the quality-loop flag is off', async () => {
    const orgSlug = 'eo-qloop-flag-off'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    // Restored in finally: clearMocks only clears calls, so a leaked
    // implementation would turn the flag off for every later test.
    const flagSpy = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockImplementation(
        async ({ feature }) => feature !== SERVE_ORDINANCE_QUALITY_LOOP_FLAG,
      )
    try {
      const res = await startLoop(slug, header)

      expect(res.status).toBe(403)
    } finally {
      flagSpy.mockRestore()
    }
  })

  it('400s starting a loop on an empty draft', async () => {
    const orgSlug = 'eo-qloop-empty'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const created = await service.client.post(
      '/v1/ordinances',
      { seedType: 'new', goalText: 'Noise' },
      header,
    )

    const res = await startLoop(created.data.slug, header)

    expect(res.status).toBe(400)
  })

  it('404s for another office ordinance', async () => {
    await seedElectedOffice('eo-qloop-owner')
    await seedElectedOffice('eo-qloop-intruder')
    const { slug } = await seedDraftOrdinance(orgHeader('eo-qloop-owner'))

    const res = await startLoop(slug, orgHeader('eo-qloop-intruder'))

    expect(res.status).toBe(404)
  })
})

describe('DELETE /v1/ordinances/:slug/quality-loop', () => {
  it('cancels a running loop and returns the cancelled state', async () => {
    const orgSlug = 'eo-qloop-cancel'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.delete(
      `/v1/ordinances/${slug}/quality-loop`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.qualityLoop.status).toBe('cancelled')
    expect(res.data.qualityLoop.phase).toBeNull()
  })
})

describe('GET /v1/ordinances/:slug/quality-iterations', () => {
  it('returns the latest run iterations with reports and revisions', async () => {
    const orgSlug = 'eo-qloop-iterations'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug, id } = await seedDraftOrdinance(header)
    const loopRunId = 'run-iterations-1'
    await service.prisma.ordinance.update({
      where: { id },
      data: {
        qualityLoopStatus: OrdinanceQualityLoopStatus.converged,
        qualityLoopRunId: loopRunId,
        qualityLoopIteration: 1,
      },
    })
    await service.prisma.ordinanceQualityIteration.create({
      data: {
        ordinanceId: id,
        loopRunId,
        iteration: 0,
        inputHash: 'hash-0',
        draftTitle: 'Draft amendment to Chapter 34',
        draftBody: 'Section 34.21 Canopy goal of forty percent by 2040.',
        report: buildReport('completeness'),
        revisedTitle: 'Draft amendment to Chapter 34',
        revisedBody: 'Section 34.21 Revised with an effective date.',
        revisedInputHash: 'hash-1',
        revisionNotes: [
          { checkId: 'completeness', note: 'Added an effective date.' },
        ],
      },
    })
    await service.prisma.ordinanceQualityIteration.create({
      data: {
        ordinanceId: id,
        loopRunId,
        iteration: 1,
        inputHash: 'hash-1',
        draftTitle: 'Draft amendment to Chapter 34',
        draftBody: 'Section 34.21 Revised with an effective date.',
        report: buildReport(),
      },
    })

    const res = await service.client.get(
      `/v1/ordinances/${slug}/quality-iterations`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.loopRunId).toBe(loopRunId)
    expect(res.data.iterations).toHaveLength(2)
    expect(res.data.iterations[0]).toMatchObject({
      iteration: 0,
      flaggedCheckIds: ['completeness'],
      revisedBody: 'Section 34.21 Revised with an effective date.',
      revisionNotes: [
        { checkId: 'completeness', note: 'Added an effective date.' },
      ],
    })
    expect(res.data.iterations[1]).toMatchObject({
      iteration: 1,
      flaggedCheckIds: [],
      revisedTitle: null,
      revisedBody: null,
    })
  })

  it('returns an empty list when no loop has run', async () => {
    const orgSlug = 'eo-qloop-iterations-none'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)

    const res = await service.client.get(
      `/v1/ordinances/${slug}/quality-iterations`,
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data).toEqual({ loopRunId: null, iterations: [] })
  })
})

describe('manual quality report vs the loop', () => {
  it('409s the manual quality report while a loop is running', async () => {
    const orgSlug = 'eo-qloop-manual-conflict'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.post(
      `/v1/ordinances/${slug}/quality-report`,
      {},
      header,
    )

    expect(res.status).toBe(409)
  })
})

describe('supersession on edit', () => {
  it('supersedes a running loop when a PATCH touches the draft body', async () => {
    const orgSlug = 'eo-qloop-supersede-body'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { draftBody: 'Section 34.21 Canopy goal of fifty percent by 2040.' },
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.qualityLoop.status).toBe('superseded_by_edit')
  })

  it('supersedes a running loop when a PATCH advances status past draft', async () => {
    const orgSlug = 'eo-qloop-supersede-status'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'in_review' },
      header,
    )

    expect(res.data.qualityLoop.status).toBe('superseded_by_edit')
  })

  it('supersedes a running loop when a PATCH regresses status to in_progress', async () => {
    const orgSlug = 'eo-qloop-supersede-regress'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    // Any move off `draft` — forward or backward — takes the record out of
    // the loop's operating domain; a run left alive would write terminals
    // over the regressed record.
    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { status: 'in_progress' },
      header,
    )

    expect(res.data.qualityLoop.status).toBe('superseded_by_edit')
  })

  it('keeps the loop running on a PATCH that touches no hash input', async () => {
    const orgSlug = 'eo-qloop-no-supersede'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      { lastViewedStep: 'draft' },
      header,
    )

    expect(res.data.qualityLoop.status).toBe('running')
  })

  it('keeps the loop running on a PATCH that resends the unchanged draft', async () => {
    const orgSlug = 'eo-qloop-noop-patch'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    // Byte-identical to what seedDraftOrdinance persisted: the hash inputs
    // did not change, so a healthy run must not be retired.
    const res = await service.client.patch(
      `/v1/ordinances/${slug}`,
      {
        draftTitle: 'Draft amendment to Chapter 34',
        draftBody: 'Section 34.21 Canopy goal of forty percent by 2040.',
      },
      header,
    )

    expect(res.status).toBe(200)
    expect(res.data.qualityLoop.status).toBe('running')
  })

  it('leaves the loop intact when the edit write itself fails', async () => {
    const orgSlug = 'eo-qloop-failed-patch'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    // superseded_by_edit is a write-once terminal: if the flip landed before
    // a write that then failed, the loop would be permanently dead while the
    // edit never happened. The flip must come after the successful write.
    const delegate = service.prisma.ordinance
    const spy = vi
      .spyOn(delegate, 'update')
      .mockRejectedValueOnce(new Error('db down'))
    try {
      const res = await service.client.patch(
        `/v1/ordinances/${slug}`,
        { draftBody: 'Section 34.21 Canopy goal of sixty percent by 2040.' },
        header,
      )
      expect(res.status).toBe(500)
    } finally {
      spy.mockRestore()
    }

    const after = await service.client.get(`/v1/ordinances/${slug}`, header)
    expect(after.data.qualityLoop.status).toBe('running')
  })

  it('supersedes a running loop when a clarify answer is saved', async () => {
    const orgSlug = 'eo-qloop-supersede-clarify'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      { questionId: 'q1', question: 'Scope?', answer: 'Citywide' },
      header,
    )

    expect(res.status).toBe(201)
    expect(res.data.qualityLoop.status).toBe('superseded_by_edit')
  })

  it('keeps the loop running when the identical clarify answer is re-submitted', async () => {
    const orgSlug = 'eo-qloop-clarify-noop'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    const answer = { questionId: 'q1', question: 'Scope?', answer: 'Citywide' }
    await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      answer,
      header,
    )
    await startLoop(slug, header)

    const res = await service.client.post(
      `/v1/ordinances/${slug}/clarify-answers`,
      answer,
      header,
    )

    expect(res.status).toBe(201)
    expect(res.data.qualityLoop.status).toBe('running')
  })
})

describe('loop state on reads', () => {
  it('shows qualityLoopStatus on the list summary while running', async () => {
    const orgSlug = 'eo-qloop-summary'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)
    await startLoop(slug, header)

    const res = await service.client.get('/v1/ordinances', header)

    expect(res.data.items[0].qualityLoopStatus).toBe('running')
  })

  it('serves a null qualityLoop before any run', async () => {
    const orgSlug = 'eo-qloop-null'
    await seedElectedOffice(orgSlug)
    const header = orgHeader(orgSlug)
    const { slug } = await seedDraftOrdinance(header)

    const res = await service.client.get(`/v1/ordinances/${slug}`, header)

    expect(res.data.qualityLoop).toBeNull()
  })
})
