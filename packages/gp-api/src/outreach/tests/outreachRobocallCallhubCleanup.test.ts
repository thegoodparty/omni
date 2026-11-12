import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { RobocallOrphanedCampaignService } from '@/outreach/services/robocallOrphanedCampaign.service'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { disableVendorCrons } from '@/shared/test-utils/appEnvOverrides'

const service = useTestService({ jobs: true })

let orphans: RobocallOrphanedCampaignService
let abortSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  orphans = service.app.get(RobocallOrphanedCampaignService)
  abortSpy = vi
    .spyOn(service.app.get(CallhubCampaignService), 'abortVoiceBroadcast')
    .mockResolvedValue(undefined)
})

const readOrphan = (campaignPkStr: string) =>
  service.prisma.robocallOrphanedCampaign.findUnique({
    where: { campaignPkStr },
  })

describe('RobocallOrphanedCampaignService.record', () => {
  it('upserts idempotently — recording the same pk_str twice keeps one row', async () => {
    await orphans.record('vb_dup', 1, 'reauth_restage')
    await orphans.record('vb_dup', 1, 'reauth_restage')

    const rows = await service.prisma.robocallOrphanedCampaign.findMany({
      where: { campaignPkStr: 'vb_dup' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.abortedAt).toBeNull()
  })

  it('does not un-abort an already-aborted row on re-record', async () => {
    await orphans.record('vb_done', 2, 'staging_lost_commit')
    const row = await readOrphan('vb_done')
    await orphans.markAborted(row!.id)

    await orphans.record('vb_done', 2, 'staging_lost_commit')

    expect((await readOrphan('vb_done'))?.abortedAt).not.toBeNull()
  })
})

describe('the robocallCallhubCleanupSweep schedule', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('aborts every unaborted campaign and stamps it aborted', async () => {
    await orphans.record('vb_a', 1, 'reauth_restage')
    await orphans.record('vb_b', 2, 'staging_lost_commit')

    await service.jobs.runSchedule('robocallCallhubCleanupSweep')

    expect(abortSpy).toHaveBeenCalledWith('vb_a')
    expect(abortSpy).toHaveBeenCalledWith('vb_b')
    expect((await readOrphan('vb_a'))?.abortedAt).not.toBeNull()
    expect((await readOrphan('vb_b'))?.abortedAt).not.toBeNull()
  })

  it('skips an already-aborted campaign (no second abort)', async () => {
    await orphans.record('vb_already', 1, 'reauth_restage')
    const row = await readOrphan('vb_already')
    await orphans.markAborted(row!.id)

    await service.jobs.runSchedule('robocallCallhubCleanupSweep')

    expect(abortSpy).not.toHaveBeenCalled()
  })

  it('isolates a per-campaign failure: others abort, the failed one retries', async () => {
    await orphans.record('vb_ok', 1, 'reauth_restage')
    await orphans.record('vb_fail', 2, 'reauth_restage')
    abortSpy.mockImplementation(async (pkStr: string) => {
      if (pkStr === 'vb_fail') throw new Error('callhub down')
    })

    const { deadLetters } = await service.jobs.runSchedule(
      'robocallCallhubCleanupSweep',
      { allowDeadLetters: true },
    )

    // The healthy one is aborted+stamped; the failed one retried, then
    // dead-lettered, and stays unaborted for the next sweep.
    const failed = await readOrphan('vb_fail')
    expect(deadLetters).toEqual([
      {
        name: 'robocallOrphanedCampaignAbort',
        data: { orphanedCampaignId: failed!.id },
        error: 'callhub down',
      },
    ])
    expect(
      abortSpy.mock.calls.filter((call: [string]) => call[0] === 'vb_fail'),
    ).toHaveLength(3)
    expect((await readOrphan('vb_ok'))?.abortedAt).not.toBeNull()
    expect(failed?.abortedAt).toBeNull()
  })

  it('elects a single stamp under a concurrent double-run', async () => {
    await orphans.record('vb_race', 1, 'reauth_restage')

    await Promise.all([
      service.jobs.runSchedule('robocallCallhubCleanupSweep'),
      service.jobs.runSchedule('robocallCallhubCleanupSweep'),
    ])

    // ABORT is idempotent, but the markAborted CAS stamps exactly one row.
    expect((await readOrphan('vb_race'))?.abortedAt).not.toBeNull()
  })

  it('no-ops on a non-prod deploy in live mode', async () => {
    disableVendorCrons()
    await orphans.record('vb_dev', 1, 'reauth_restage')

    await service.jobs.runSchedule('robocallCallhubCleanupSweep')

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readOrphan('vb_dev'))?.abortedAt).toBeNull()
  })
})
