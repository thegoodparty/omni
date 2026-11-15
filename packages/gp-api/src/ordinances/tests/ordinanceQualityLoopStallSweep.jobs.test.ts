import { randomUUID } from 'crypto'
import { subMinutes } from 'date-fns'
import { describe, expect, it } from 'vitest'
import {
  OrdinanceQualityLoopStatus,
  OrdinanceSeedType,
  OrdinanceStatus,
  Prisma,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'

const service = useTestService({ jobs: true })

const seedLoop = async (
  overrides: Partial<Prisma.OrdinanceUncheckedCreateInput> = {},
) => {
  const slug = `qloop-stall-${randomUUID()}`
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
      draftBody: 'Section 1. No person shall operate without a permit.',
      qualityLoopStatus: OrdinanceQualityLoopStatus.running,
      qualityLoopRunId: randomUUID(),
      qualityLoopIteration: 0,
      qualityLoopUpdatedAt: new Date(),
      ...overrides,
    },
  })
}

const loopStatus = async (id: string) =>
  (await service.prisma.ordinance.findUniqueOrThrow({ where: { id } }))
    .qualityLoopStatus

describe('ordinanceQualityLoopStallSweep schedule', () => {
  it('flips only stale running loops to failed', async () => {
    const stale = await seedLoop({
      qualityLoopUpdatedAt: subMinutes(new Date(), 45),
    })
    const neverUpdated = await seedLoop({ qualityLoopUpdatedAt: null })
    const fresh = await seedLoop()
    const terminal = await seedLoop({
      qualityLoopStatus: OrdinanceQualityLoopStatus.converged,
      qualityLoopUpdatedAt: subMinutes(new Date(), 45),
    })

    await service.jobs.runSchedule('ordinanceQualityLoopStallSweep')

    expect(await loopStatus(stale.id)).toBe(OrdinanceQualityLoopStatus.failed)
    expect(await loopStatus(neverUpdated.id)).toBe(
      OrdinanceQualityLoopStatus.failed,
    )
    expect(await loopStatus(fresh.id)).toBe(OrdinanceQualityLoopStatus.running)
    expect(await loopStatus(terminal.id)).toBe(
      OrdinanceQualityLoopStatus.converged,
    )
  })
})
