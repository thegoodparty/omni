import { ClerkClient } from '@clerk/backend'
import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { recordClerkUserCounts } from '../util/clerkUsers.metrics'
import { UsersService } from './users.service'

vi.mock('../util/clerkUsers.metrics', () => ({
  recordClerkUserCounts: vi.fn(),
}))

const service = useTestService({ jobs: true })

describe('the testUserSweep schedule', () => {
  let usersService: UsersService
  let clerkClient: ClerkClient

  const runSweep = () => service.jobs.runSchedule('testUserSweep')

  beforeEach(() => {
    usersService = service.app.get(UsersService)
    clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
    vi.spyOn(clerkClient.users, 'getCount').mockResolvedValue(0)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does not sweep on a PR-preview stack', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const sweep = vi
      .spyOn(usersService, 'deleteTestUsers')
      .mockResolvedValue(undefined)
    const getUserList = vi.spyOn(clerkClient.users, 'getUserList')

    await runSweep()

    expect(sweep).not.toHaveBeenCalled()
    expect(getUserList).not.toHaveBeenCalled()
  })

  it('fails closed when the deploy environment is absent', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', undefined)
    const sweep = vi
      .spyOn(usersService, 'deleteTestUsers')
      .mockResolvedValue(undefined)

    await runSweep()

    expect(sweep).not.toHaveBeenCalled()
  })

  it.each(['dev', 'prod'])('sweeps on the %s deploy', async (environment) => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', environment)
    const sweep = vi
      .spyOn(usersService, 'deleteTestUsers')
      .mockResolvedValue(undefined)

    await runSweep()

    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('records the total and test-domain Clerk user counts', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    vi.spyOn(usersService, 'deleteTestUsers').mockResolvedValue(undefined)
    const getCount = vi
      .spyOn(clerkClient.users, 'getCount')
      .mockImplementation(async (params) => (params?.query ? 2_700 : 41_000))

    await runSweep()

    expect(getCount).toHaveBeenCalledTimes(2)
    expect(getCount).toHaveBeenCalledWith()
    expect(getCount).toHaveBeenCalledWith({ query: '@test.goodparty.org' })
    expect(recordClerkUserCounts).toHaveBeenCalledWith({
      total: 41_000,
      testDomain: 2_700,
    })
  })

  it('counts before the sweep deletes anything', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    const sweep = vi
      .spyOn(usersService, 'deleteTestUsers')
      .mockResolvedValue(undefined)
    const getCount = vi.spyOn(clerkClient.users, 'getCount')

    await runSweep()

    const [firstCount] = getCount.mock.invocationCallOrder
    const [sweepStart] = sweep.mock.invocationCallOrder
    expect(firstCount).toBeLessThan(sweepStart!)
  })

  it('still sweeps when the count call fails', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    const sweep = vi
      .spyOn(usersService, 'deleteTestUsers')
      .mockResolvedValue(undefined)
    vi.spyOn(clerkClient.users, 'getCount').mockRejectedValue(
      new Error('clerk down'),
    )

    await runSweep()

    expect(recordClerkUserCounts).not.toHaveBeenCalled()
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('does not count on a PR-preview stack', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const getCount = vi.spyOn(clerkClient.users, 'getCount')

    await runSweep()

    expect(getCount).not.toHaveBeenCalled()
    expect(recordClerkUserCounts).not.toHaveBeenCalled()
  })

  // A deploy stops the task: the attempt fails, and its retry on another
  // task sweeps what is left.
  it('stops deleting once the job is aborted', async () => {
    const stale = await service.prisma.user.create({
      data: {
        email: `aborted-${Date.now()}@test.goodparty.org`,
        createdAt: subDays(new Date(), 2),
      },
    })

    await expect(
      usersService.deleteTestUsers(AbortSignal.abort()),
    ).rejects.toThrow()

    expect(
      await service.prisma.user.findUnique({ where: { id: stale.id } }),
    ).not.toBeNull()
  })
})
