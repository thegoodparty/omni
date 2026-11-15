import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PersonIdBackfillService } from './person-id-backfill.service'

const service = useTestService({ jobs: true })

const backfill = () => service.app.get(PersonIdBackfillService)

describe('personIdReconcile schedule', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sweeps a bounded batch of unlinked and of linked users', async () => {
    const sweep = vi
      .spyOn(backfill(), 'reconcileNullPersonIds')
      .mockResolvedValue({ scanned: 0, linked: 0 })
    const driftSweep = vi
      .spyOn(backfill(), 'reconcileDriftedPersonIds')
      .mockResolvedValue({ scanned: 0, repointed: 0, collisions: 0 })

    await service.jobs.runSchedule('personIdReconcile')

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(sweep).toHaveBeenCalledWith(500)
    expect(driftSweep).toHaveBeenCalledTimes(1)
    expect(driftSweep).toHaveBeenCalledWith(500)
  })

  it('still runs the drift sweep when the null-id sweep throws, and retries', async () => {
    vi.spyOn(backfill(), 'reconcileNullPersonIds').mockRejectedValue(
      new Error('prisma boom'),
    )
    const driftSweep = vi
      .spyOn(backfill(), 'reconcileDriftedPersonIds')
      .mockResolvedValue({ scanned: 0, repointed: 0, collisions: 0 })

    // A null-id sweep that keeps failing must not starve the drift sweep: a
    // takedown keyed to a retired id would stay unhonored.
    const { deadLetters } = await service.jobs.runSchedule(
      'personIdReconcile',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      { name: 'personIdReconcile', data: {}, error: 'prisma boom' },
    ])
    expect(driftSweep).toHaveBeenCalledTimes(3)
    expect(driftSweep).toHaveBeenCalledWith(500)
  })

  it('surfaces both failures when both sweeps throw', async () => {
    vi.spyOn(backfill(), 'reconcileNullPersonIds').mockRejectedValue(
      new Error('null sweep boom'),
    )
    vi.spyOn(backfill(), 'reconcileDriftedPersonIds').mockRejectedValue(
      new Error('drift sweep boom'),
    )

    const { deadLetters } = await service.jobs.runSchedule(
      'personIdReconcile',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'personIdReconcile',
        data: {},
        error: 'both person_id reconcile sweeps failed',
      },
    ])
  })
})
