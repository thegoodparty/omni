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
    const sweep = vi
      .spyOn(service.app.get(PersonIdBackfillService), 'reconcileNullPersonIds')
      .mockResolvedValue({ scanned: 0, linked: 0 })

    await reconcileService().reconcile()

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(sweep).toHaveBeenCalledWith(500)
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
    // finally still marks completed so the claim isn't stranded.
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })
})
