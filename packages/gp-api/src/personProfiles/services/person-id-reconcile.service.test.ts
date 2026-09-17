import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { PersonIdBackfillService } from './person-id-backfill.service'
import { PersonIdReconcileService } from './person-id-reconcile.service'

const service = useTestService()

const reconcileService = () => service.app.get(PersonIdReconcileService)

describe('PersonIdReconcileService.reconcile', () => {
  afterEach(() => vi.restoreAllMocks())

  it('claims the daily run, sweeps a bounded batch, and marks completed', async () => {
    const cronLock = service.app.get(CronLockService)
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    const markCompleted = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)
    const backfill = service.app.get(PersonIdBackfillService)
    const sweep = vi
      .spyOn(backfill, 'reconcileNullPersonIds')
      .mockResolvedValue({ scanned: 0, linked: 0 })
    const driftSweep = vi
      .spyOn(backfill, 'reconcileDriftedPersonIds')
      .mockResolvedValue({ scanned: 0, repointed: 0, collisions: 0 })

    await reconcileService().reconcile()

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(sweep).toHaveBeenCalledWith(500)
    expect(driftSweep).toHaveBeenCalledTimes(1)
    expect(driftSweep).toHaveBeenCalledWith(500)
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })

  it('no-ops when another replica already claimed the run', async () => {
    const cronLock = service.app.get(CronLockService)
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(false)
    const sweep = vi
      .spyOn(service.app.get(PersonIdBackfillService), 'reconcileNullPersonIds')
      .mockResolvedValue({ scanned: 0, linked: 0 })

    await reconcileService().reconcile()

    expect(sweep).not.toHaveBeenCalled()
  })

  it('releases the daily lock even if the sweep throws', async () => {
    const cronLock = service.app.get(CronLockService)
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    const markCompleted = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)
    vi.spyOn(
      service.app.get(PersonIdBackfillService),
      'reconcileNullPersonIds',
    ).mockRejectedValue(new Error('prisma boom'))

    await expect(reconcileService().reconcile()).rejects.toThrow('prisma boom')
    // The claim is stamped complete regardless so it isn't stranded.
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })

  it('still runs the drift sweep when the null-id sweep throws', async () => {
    const cronLock = service.app.get(CronLockService)
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    vi.spyOn(cronLock, 'markCompleted').mockResolvedValue(undefined)
    const backfill = service.app.get(PersonIdBackfillService)
    vi.spyOn(backfill, 'reconcileNullPersonIds').mockRejectedValue(
      new Error('prisma boom'),
    )
    const driftSweep = vi
      .spyOn(backfill, 'reconcileDriftedPersonIds')
      .mockResolvedValue({ scanned: 0, repointed: 0, collisions: 0 })

    // The day is stamped complete either way, so a drift sweep skipped here
    // never runs at all — a takedown keyed to a retired id stays unhonored.
    await expect(reconcileService().reconcile()).rejects.toThrow('prisma boom')

    expect(driftSweep).toHaveBeenCalledTimes(1)
    expect(driftSweep).toHaveBeenCalledWith(500)
  })

  it('surfaces both failures when both sweeps throw', async () => {
    const cronLock = service.app.get(CronLockService)
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    const markCompleted = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)
    const backfill = service.app.get(PersonIdBackfillService)
    vi.spyOn(backfill, 'reconcileNullPersonIds').mockRejectedValue(
      new Error('null sweep boom'),
    )
    vi.spyOn(backfill, 'reconcileDriftedPersonIds').mockRejectedValue(
      new Error('drift sweep boom'),
    )

    const error = await reconcileService()
      .reconcile()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AggregateError)
    expect(
      (error as AggregateError).errors.map((e: Error) => e.message),
    ).toEqual(['null sweep boom', 'drift sweep boom'])
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })
})
