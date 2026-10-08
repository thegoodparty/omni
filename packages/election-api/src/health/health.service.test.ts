import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HealthService,
  HEALTH_PROBE_TTL_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  HEALTH_STALE_AFTER_MS,
} from './health.service'
import { PrismaService } from '../prisma/prisma.service'
import { PinoLogger } from 'nestjs-pino'

/** What Prisma throws when its pool cannot hand over a connection in time. */
const poolTimeout = () =>
  Object.assign(
    new Error(
      'Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 20, connection limit: 25)',
    ),
    { code: 'P2024' },
  )

describe('HealthService', () => {
  let service: HealthService
  let prisma: Pick<PrismaService, '$queryRaw'>
  let logger: Pick<PinoLogger, 'setContext' | 'error' | 'warn'>

  beforeEach(() => {
    vi.useFakeTimers()

    prisma = {
      $queryRaw: vi.fn(),
    }

    logger = {
      setContext: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }

    service = new HealthService(prisma as PrismaService, logger as PinoLogger)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true when database query succeeds', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

    const result = await service.checkHealth()

    expect(result).toBe(true)
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns false and logs when database query fails', async () => {
    const error = new Error('db is down')
    vi.mocked(prisma.$queryRaw).mockRejectedValue(error)

    const result = await service.checkHealth()

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      'Health check failed => ',
    )
  })

  it('stays healthy when the pool is exhausted but was healthy recently', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }])
    expect(await service.checkHealth()).toBe(true)

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TTL_MS)
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(poolTimeout())

    expect(await service.checkHealth()).toBe(true)
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('reports unhealthy when the pool is exhausted and no probe has ever succeeded', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(poolTimeout())

    expect(await service.checkHealth()).toBe(false)
  })

  it('reports unhealthy once saturation has outlasted the stale window', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }])
    expect(await service.checkHealth()).toBe(true)

    await vi.advanceTimersByTimeAsync(HEALTH_STALE_AFTER_MS + 1)
    vi.mocked(prisma.$queryRaw).mockRejectedValue(poolTimeout())

    expect(await service.checkHealth()).toBe(false)
  })

  it('answers within the probe budget when a query hangs, instead of waiting out the pool timeout', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }])
    expect(await service.checkHealth()).toBe(true)

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TTL_MS)
    vi.mocked(prisma.$queryRaw).mockReturnValueOnce(
      new Promise(() => {}) as never,
    )

    const pending = service.checkHealth()
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS)

    expect(await pending).toBe(true)
  })

  it('reuses one probe for every check inside the cache window', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])

    expect(await service.checkHealth()).toBe(true)
    expect(await service.checkHealth()).toBe(true)
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TTL_MS)
    expect(await service.checkHealth()).toBe(true)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('shares a single in-flight probe between concurrent checks', async () => {
    let settle: (rows: unknown) => void = () => {}
    vi.mocked(prisma.$queryRaw).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }) as never,
    )

    const first = service.checkHealth()
    const second = service.checkHealth()
    settle([{ '?column?': 1 }])

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
  })
})
