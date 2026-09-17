import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { CronLockService } from './cronLock.service'

const service = useTestService()

const JOB = 'jobX'

describe('CronLockService.tryClaimDailyRun', () => {
  beforeEach(async () => {
    await service.prisma.cronRun.deleteMany({})
  })

  it('grants the first caller and denies a second caller for the same UTC day', async () => {
    const lock = service.app.get(CronLockService)
    const now = new Date('2026-05-29T07:00:00.000Z')

    expect(await lock.tryClaimDailyRun(JOB, now)).toBe(true)
    expect(await lock.tryClaimDailyRun(JOB, now)).toBe(false)
  })

  it('treats different times on the same UTC date as the same claim', async () => {
    const lock = service.app.get(CronLockService)

    // Two times on the same UTC date, within the staleness window so the active
    // claim is not eligible for takeover.
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T00:00:01.000Z')),
    ).toBe(true)
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T04:00:00.000Z')),
    ).toBe(false)
  })

  it('denies a second instance firing ~1s later the same day (two-replica race)', async () => {
    const lock = service.app.get(CronLockService)

    // The two ECS replicas fire their @Cron a fraction of a second apart. The
    // lock keys on the date only, so both resolve to the same runDate and only
    // the first wins — sub-second clock differences must not let both through.
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T07:00:00.123Z')),
    ).toBe(true)
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T07:00:01.456Z')),
    ).toBe(false)
  })

  it('grants the claim again on a different UTC day', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T12:00:00.000Z')),
    ).toBe(true)
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-30T12:00:00.000Z')),
    ).toBe(true)
  })

  it('isolates claims per jobName', async () => {
    const lock = service.app.get(CronLockService)
    const now = new Date('2026-05-29T07:00:00.000Z')

    expect(await lock.tryClaimDailyRun('jobA', now)).toBe(true)
    expect(await lock.tryClaimDailyRun('jobB', now)).toBe(true)
  })

  it('does not take over an in-progress (not yet stale) claim', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T07:00:00.000Z')),
    ).toBe(true)
    // 2 hours later, same day: prior claim is still within the staleness window.
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T09:00:00.000Z')),
    ).toBe(false)
  })

  it('takes over a stale claim that never completed (crashed run)', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T07:00:00.000Z')),
    ).toBe(true)
    // 7 hours later (> STALE_CLAIM_MS) with no markCompleted: assume a crash.
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T14:00:00.000Z')),
    ).toBe(true)
  })

  it('lets only one of two concurrent takeovers win', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T07:00:00.000Z')),
    ).toBe(true)

    // Two replicas race to take over the same stale claim; the conditional
    // update must let exactly one succeed.
    const later = new Date('2026-05-29T14:00:00.000Z')
    const results = await Promise.all([
      lock.tryClaimDailyRun(JOB, later),
      lock.tryClaimDailyRun(JOB, later),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('never takes over a completed claim, even when stale', async () => {
    const lock = service.app.get(CronLockService)
    const now = new Date('2026-05-29T07:00:00.000Z')

    expect(await lock.tryClaimDailyRun(JOB, now)).toBe(true)
    await lock.markCompleted(JOB, now)

    // Long after completion, same day: a completed run must not be retried.
    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T20:00:00.000Z')),
    ).toBe(false)
  })

  // run_date widened from DATE to TIMESTAMP so hourly slots are
  // representable. Daily claims must still collapse to one per UTC day: this
  // walks the whole day, hour by hour, and only the first may win. Six live
  // callers (meeting briefings, community issues x2, opponent research,
  // person-id reconcile, campaign tracker, ordinance refresh) depend on it —
  // a second daily win means duplicate paid agent dispatches.
  it('grants at most one claim across every hour of a UTC day', async () => {
    const lock = service.app.get(CronLockService)

    const results: boolean[] = []
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 4, 29, hour, 30))
      results.push(await lock.tryClaimDailyRun(JOB, at))
      // Seal it each time so a takeover can never account for a second win.
      await lock.markCompleted(JOB, at)
    }

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results[0]).toBe(true)
    expect(
      await service.prisma.cronRun.count({ where: { jobName: JOB } }),
    ).toBe(1)
  })

  it('stores the daily claim at exact UTC midnight', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimDailyRun(JOB, new Date('2026-05-29T17:42:11.987Z')),
    ).toBe(true)

    const row = await service.prisma.cronRun.findFirstOrThrow({
      where: { jobName: JOB },
    })
    expect(row.runDate.toISOString()).toBe('2026-05-29T00:00:00.000Z')
  })
})

describe('CronLockService.tryClaimHourlyRun', () => {
  beforeEach(async () => {
    await service.prisma.cronRun.deleteMany({})
  })

  it('grants the first caller and denies a second in the same UTC hour', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:23:00.100Z')),
    ).toBe(true)
    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:23:01.400Z')),
    ).toBe(false)
    // Later in the same hour but still inside the staleness window, so the
    // active claim is not eligible for takeover either.
    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:35:00.000Z')),
    ).toBe(false)
  })

  it('grants the claim again in the next UTC hour', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:23:00.000Z')),
    ).toBe(true)
    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T08:23:00.000Z')),
    ).toBe(true)
  })

  it('stores the claim at the exact UTC hour start', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:23:11.987Z')),
    ).toBe(true)

    const row = await service.prisma.cronRun.findFirstOrThrow({
      where: { jobName: JOB },
    })
    expect(row.runDate.toISOString()).toBe('2026-05-29T07:00:00.000Z')
  })

  it('does not collide with a daily claim for the same job at midnight-adjacent hours', async () => {
    const lock = service.app.get(CronLockService)
    const at = new Date('2026-05-29T00:23:00.000Z')

    // The 00:00 hourly slot and the daily slot share the same runDate, so a
    // job must not use both claim styles under one name. Different names are
    // independent, which is what callers actually do.
    expect(await lock.tryClaimHourlyRun('hourlyJob', at)).toBe(true)
    expect(await lock.tryClaimDailyRun('dailyJob', at)).toBe(true)
  })

  it('does not take over an in-progress (not yet stale) hourly claim', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:00:00.000Z')),
    ).toBe(true)
    // 10 minutes later, same hour: inside STALE_HOURLY_CLAIM_MS (30m).
    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:10:00.000Z')),
    ).toBe(false)
  })

  it('takes over a stale hourly claim that never completed', async () => {
    const lock = service.app.get(CronLockService)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:00:00.000Z')),
    ).toBe(true)
    // 40 minutes later, still the same hour, past the 30m hourly window.
    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:40:00.000Z')),
    ).toBe(true)
  })

  it('lets only one of two concurrent hourly claims win', async () => {
    const lock = service.app.get(CronLockService)
    const now = new Date('2026-05-29T07:23:00.000Z')

    const results = await Promise.all([
      lock.tryClaimHourlyRun(JOB, now),
      lock.tryClaimHourlyRun(JOB, now),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('never takes over a completed hourly claim, even when stale', async () => {
    const lock = service.app.get(CronLockService)
    const now = new Date('2026-05-29T07:23:00.000Z')

    expect(await lock.tryClaimHourlyRun(JOB, now)).toBe(true)
    await lock.markHourlyCompleted(JOB, now)

    expect(
      await lock.tryClaimHourlyRun(JOB, new Date('2026-05-29T07:58:00.000Z')),
    ).toBe(false)
  })
})
