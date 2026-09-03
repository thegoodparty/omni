import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadGatewayException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { useTestService } from '@/test-service'
import { OutreachRobocallCallhubCleanupService } from '@/outreach/services/outreachRobocallCallhubCleanup.service'
import { RobocallOrphanedCampaignService } from '@/outreach/services/robocallOrphanedCampaign.service'
import { ROBOCALL_VENDOR } from '@/outreach/vendor/robocallVendor'
import { VendorPermanentError } from '@/outreach/vendor/vendorPermanentError'

const service = useTestService()

let cleanup: OutreachRobocallCallhubCleanupService
let orphans: RobocallOrphanedCampaignService
let abortSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  cleanup = service.app.get(OutreachRobocallCallhubCleanupService)
  orphans = service.app.get(RobocallOrphanedCampaignService)
  abortSpy = vi
    .spyOn(service.app.get(ROBOCALL_VENDOR), 'abortBroadcast')
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

describe('OutreachRobocallCallhubCleanupService.sweepOrphanedCampaigns', () => {
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

    await cleanup.sweepOrphanedCampaigns()

    expect(abortSpy).toHaveBeenCalledWith('vb_a')
    expect(abortSpy).toHaveBeenCalledWith('vb_b')
    expect((await readOrphan('vb_a'))?.abortedAt).not.toBeNull()
    expect((await readOrphan('vb_b'))?.abortedAt).not.toBeNull()
  })

  it('skips an already-aborted campaign (no second abort)', async () => {
    await orphans.record('vb_already', 1, 'reauth_restage')
    const row = await readOrphan('vb_already')
    await orphans.markAborted(row!.id)

    await cleanup.sweepOrphanedCampaigns()

    expect(abortSpy).not.toHaveBeenCalled()
  })

  it('stamps a permanently-gone campaign handled instead of retrying forever', async () => {
    await orphans.record('vb_gone', 1, 'reauth_restage')
    abortSpy.mockRejectedValueOnce(new VendorPermanentError('campaign gone'))
    const warnSpy = vi.spyOn(
      (cleanup as unknown as { logger: PinoLogger }).logger,
      'warn',
    )

    await cleanup.sweepOrphanedCampaigns()

    // A permanent failure can never be aborted, so it is stamped handled (not
    // left null to retry every sweep forever), and a warn records why.
    expect((await readOrphan('vb_gone'))?.abortedAt).not.toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('leaves a transient failure unaborted to retry and logs an error', async () => {
    await orphans.record('vb_transient', 1, 'reauth_restage')
    abortSpy.mockRejectedValueOnce(new BadGatewayException('callhub 502'))
    const errorSpy = vi.spyOn(
      (cleanup as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await cleanup.sweepOrphanedCampaigns()

    expect((await readOrphan('vb_transient'))?.abortedAt).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('isolates a per-campaign failure: others abort, the failed one retries', async () => {
    await orphans.record('vb_ok', 1, 'reauth_restage')
    await orphans.record('vb_fail', 2, 'reauth_restage')
    abortSpy.mockImplementation(async (pkStr: string) => {
      if (pkStr === 'vb_fail') throw new Error('callhub down')
    })

    await cleanup.sweepOrphanedCampaigns()

    // The healthy one is aborted+stamped; the failed one stays unaborted to retry.
    expect((await readOrphan('vb_ok'))?.abortedAt).not.toBeNull()
    expect((await readOrphan('vb_fail'))?.abortedAt).toBeNull()
  })

  it('elects a single stamp under a concurrent double-run', async () => {
    await orphans.record('vb_race', 1, 'reauth_restage')

    await Promise.all([
      cleanup.sweepOrphanedCampaigns(),
      cleanup.sweepOrphanedCampaigns(),
    ])

    // ABORT is idempotent, but the markAborted CAS stamps exactly one row.
    expect((await readOrphan('vb_race'))?.abortedAt).not.toBeNull()
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await orphans.record('vb_dev', 1, 'reauth_restage')

    await cleanup.sweepOrphanedCampaigns()

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readOrphan('vb_dev'))?.abortedAt).toBeNull()
  })
})
