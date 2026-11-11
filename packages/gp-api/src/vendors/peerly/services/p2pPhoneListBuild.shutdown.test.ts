import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { ElectionsService } from '@/elections/services/elections.service'
import { OfficeLevel } from '@/generated/prisma'
import { JOBS, SCHEDULES } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import { P2pPhoneListUploadService } from './p2pPhoneListUpload.service'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'

// A deploy stopping a p2pPhoneListBuild job mid-resolution. The test app runs
// no workers; two stand-in gp-api tasks do, one stopped part way through.
const service = useTestService()

const SLUG = 'campaign-p2p-build-shutdown'
const DISTRICT_ID = '20000000-0000-0000-0000-000000000000'

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

const waitFor = async (check: () => Promise<boolean> | boolean) => {
  const deadline = performance.now() + 15_000
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(100)
  }
}

const page = (ids: string[]) =>
  ({
    people: ids.map((id, index) => ({
      id,
      firstName: 'Jane',
      lastName: 'Doe',
      cellPhone: `55512300${String(index).padStart(2, '0')}`,
      address: { city: 'Springfield', state: 'CA', zip: '90210' },
    })),
    pagination: { totalResults: ids.length, hasNextPage: false },
  }) as never

describe('p2pPhoneListBuild at shutdown', () => {
  it('gives the build back unspent and lets the requeued job build it on another task', async () => {
    vi.spyOn(
      service.app.get(ElectionsService),
      'getDistrict',
    ).mockResolvedValue({
      id: DISTRICT_ID,
      state: 'CA',
      L2DistrictType: 'County',
      L2DistrictName: 'Test County',
      projectedTurnout: null,
    } as never)
    await service.prisma.organization.create({
      data: {
        slug: SLUG,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${SLUG}-campaign`,
        organizationSlug: SLUG,
        isPro: true,
      },
    })
    await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        ein: '12-3456789',
        postalAddress: '123 Main St',
        committeeName: 'Test Committee',
        websiteDomain: 'example.com',
        filingUrl: 'https://example.com/filing',
        phone: '5551234567',
        email: 'test@example.com',
        officeLevel: OfficeLevel.state,
        peerlyIdentityId: 'peerly-identity-1',
      },
    })
    const build = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: SLUG,
        campaignId: campaign.id,
        requestSnapshot: { name: 'Interrupted build' },
      },
    })
    // The first run's people read waits until its task starts shutting down.
    let release: () => void = () => undefined
    const firstReadHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockImplementation(async () => {
      reads++
      if (reads === 1) await firstReadHeld
      return page([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ])
    })
    const upload = vi
      .spyOn(service.app.get(PeerlyPhoneListService), 'uploadPhoneList')
      .mockResolvedValue('after-deploy-token')

    const first = await startTask()
    await service.app.get(P2pPhoneListUploadService).enqueueBuild(build.id, 0)
    await waitFor(() => reads === 1)
    const stopping = first.onModuleDestroy()
    release()
    await stopping

    expect(upload).not.toHaveBeenCalled()
    expect(
      await service.prisma.peerlyPhoneList.findUniqueOrThrow({
        where: { id: build.id },
      }),
    ).toMatchObject({ buildStatus: 'queued', buildAttempts: 0 })
    // Stands in for waiting out the requeued job's delay
    // (REQUEUE_DELAY_SECONDS in jobs.service.ts).
    expect(
      await service.prisma.$executeRaw`
        UPDATE pgboss.job SET start_after = now()
        WHERE name = 'p2pPhoneListBuild' AND state = 'retry'`,
    ).toBe(1)

    const second = await startTask()
    try {
      await waitFor(
        async () =>
          (
            await service.prisma.peerlyPhoneList.findUniqueOrThrow({
              where: { id: build.id },
            })
          ).buildStatus === 'processing',
      )
    } finally {
      await second.onModuleDestroy()
    }
    expect(upload).toHaveBeenCalledOnce()
    expect(
      await service.prisma.peerlyPhoneList.findUniqueOrThrow({
        where: { id: build.id },
      }),
    ).toMatchObject({ token: 'after-deploy-token', buildAttempts: 1 })
  })
})
