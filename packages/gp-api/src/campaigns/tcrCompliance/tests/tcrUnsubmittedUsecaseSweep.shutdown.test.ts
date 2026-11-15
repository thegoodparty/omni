import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { OfficeLevel, TcrComplianceStatus } from '@/generated/prisma'
import { JOBS, SCHEDULES } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import { PeerlyCvVerificationStatus } from '@/vendors/peerly/peerly.types'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'

// A deploy stopping a tcrUnsubmittedUsecaseSweep run part way through its
// records. The test app runs no workers; two stand-in gp-api tasks do, the
// first stopped while the run is in its first record's Peerly calls.
const service = useTestService()

const startTask = async (): Promise<JobsService> => {
  const task = new JobsService(
    JOBS,
    SCHEDULES,
    service.app.get(PrismaService),
    service.app.get(ModuleRef),
    await service.app.resolve(PinoLogger),
  )
  vi.stubEnv('TEST_JOBS', 'on')
  try {
    await task.onModuleInit()
    await task.onApplicationBootstrap()
  } finally {
    vi.unstubAllEnvs()
  }
  return task
}

const waitFor = async (check: () => boolean) => {
  const deadline = performance.now() + 15_000
  while (!check()) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(100)
  }
}

const seedVerifiedRecord = async (name: string) => {
  const user = await service.prisma.user.create({
    data: { email: `${name}@example.com`, firstName: 'Jane', lastName: 'Doe' },
  })
  await service.prisma.organization.create({
    data: { slug: name, ownerId: user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      slug: name,
      organizationSlug: name,
      userId: user.id,
      isPro: true,
    },
  })
  return service.prisma.tcrCompliance.create({
    data: {
      campaignId: campaign.id,
      ein: '12-3456789',
      postalAddress: '123 Main St',
      committeeName: 'Friends of Jane Doe',
      websiteDomain: 'example.org',
      filingUrl: 'https://sos.example.gov/filing',
      phone: '555-000-1234',
      email: `${name}@example.com`,
      officeLevel: OfficeLevel.local,
      status: TcrComplianceStatus.submitted,
      peerlyIdentityId: `peerly-${name}`,
      peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
    },
  })
}

describe('tcrUnsubmittedUsecaseSweep at shutdown', () => {
  it('finishes the record in flight, stops before claiming the next, and the requeued run submits it', async () => {
    const records = [
      await seedVerifiedRecord('usecase-sweep-shutdown-a'),
      await seedVerifiedRecord('usecase-sweep-shutdown-b'),
    ]
    const peerly = service.app.get(PeerlyIdentityService)
    let release: () => void = () => undefined
    const firstProfileHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    // The identities whose usecase submission started. Submitting reads
    // the identity's profile again, so a Set.
    const profiled = new Set<string>()
    vi.spyOn(peerly, 'getIdentityProfile').mockImplementation(
      async (identityId) => {
        const isFirst = profiled.size === 0
        profiled.add(identityId)
        if (isFirst) await firstProfileHeld
        return { profile: { status: 'pending' } } as never
      },
    )
    const mint = vi
      .spyOn(peerly, 'createCampaignVerifyToken')
      .mockResolvedValue('cv-token')
    const approve = vi
      .spyOn(peerly, 'submitCampaignVerifyTokenToBrand')
      .mockResolvedValue(undefined)

    const first = await startTask()
    await first.sendScheduleRun('tcrUnsubmittedUsecaseSweep')
    await waitFor(() => profiled.size === 1)
    const stopping = first.onModuleDestroy()
    release()
    await stopping

    expect(profiled.size).toBe(1)
    expect(mint).toHaveBeenCalledOnce()
    expect(approve).toHaveBeenCalledOnce()
    const claims = await service.prisma.tcrCompliance.findMany({
      where: { id: { in: records.map((record) => record.id) } },
      select: { usecaseSubmitClaimedAt: true },
    })
    expect(claims).toEqual([
      { usecaseSubmitClaimedAt: null },
      { usecaseSubmitClaimedAt: null },
    ])
    // Stands in for waiting out the requeued job's delay
    // (REQUEUE_DELAY_SECONDS in jobs.service.ts).
    expect(
      await service.prisma.$executeRaw`
        UPDATE pgboss.job SET start_after = now()
        WHERE name = 'tcrUnsubmittedUsecaseSweep' AND state = 'retry'`,
    ).toBe(1)

    const second = await startTask()
    try {
      await waitFor(() => profiled.size === 2)
    } finally {
      await second.onModuleDestroy()
    }
  })
})
