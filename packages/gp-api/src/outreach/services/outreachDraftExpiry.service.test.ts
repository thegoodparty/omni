import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'
import { OutreachDraftService } from './outreachDraft.service'
import {
  DRAFT_RETENTION_DAYS,
  OutreachDraftExpiryService,
} from './outreachDraftExpiry.service'

const service = useTestService()

const ORG_SLUG = 'draft-expiry-org'

const expiryService = () => service.app.get(OutreachDraftExpiryService)

beforeEach(async () => {
  await service.prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { slug: ORG_SLUG, ownerId: service.user.id },
    update: {},
  })
})

const mockCronLock = (claimed: boolean) => {
  const cronLock = service.app.get(CronLockService)
  return {
    claimSpy: vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(claimed),
    completeSpy: vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined),
  }
}

const createDraft = (createdAt: Date) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.draft,
      createdAt,
    },
  })

describe('OutreachDraftExpiryService.expireDrafts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('deletes a draft older than the retention window and marks completed', async () => {
    const stale = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    const { completeSpy } = mockCronLock(true)

    await expiryService().expireDrafts()

    expect(
      await service.prisma.outreach.findUnique({ where: { id: stale.id } }),
    ).toBeNull()
    expect(completeSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps a draft inside the retention window', async () => {
    const fresh = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS - 1),
    )
    mockCronLock(true)

    await expiryService().expireDrafts()

    expect(
      await service.prisma.outreach.findUnique({ where: { id: fresh.id } }),
    ).not.toBeNull()
  })

  it('does no work when another replica already holds the lease', async () => {
    const stale = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    const { completeSpy } = mockCronLock(false)

    await expiryService().expireDrafts()

    expect(
      await service.prisma.outreach.findUnique({ where: { id: stale.id } }),
    ).not.toBeNull()
    expect(completeSpy).not.toHaveBeenCalled()
  })

  it('runs the sweep once when the cron fires twice in the same slot', async () => {
    const stale = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    const cronLock = service.app.get(CronLockService)
    const claimSpy = vi
      .spyOn(cronLock, 'tryClaimDailyRun')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const completeSpy = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)

    await expiryService().expireDrafts()
    await expiryService().expireDrafts()

    expect(claimSpy).toHaveBeenCalledTimes(2)
    // Only the first (claimed) invocation ran the sweep and sealed the lease.
    expect(completeSpy).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.outreach.findUnique({ where: { id: stale.id } }),
    ).toBeNull()
  })

  it('continues past a delete failure and still expires the other row', async () => {
    const failing = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    const succeeding = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 2),
    )
    const drafts = service.app.get(OutreachDraftService)
    const realDeleteDraftRow = drafts.deleteDraftRow.bind(drafts)
    vi.spyOn(drafts, 'deleteDraftRow').mockImplementation(async (row) => {
      if (row.id === failing.id) throw new Error('boom')
      return realDeleteDraftRow(row)
    })
    const { completeSpy } = mockCronLock(true)

    await expiryService().expireDrafts()

    expect(
      await service.prisma.outreach.findUnique({ where: { id: failing.id } }),
    ).not.toBeNull()
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: succeeding.id },
      }),
    ).toBeNull()
    expect(completeSpy).toHaveBeenCalledTimes(1)
  })

  it('marks the run completed even when the scan itself throws', async () => {
    vi.spyOn(service.prisma.outreach, 'findMany').mockRejectedValue(
      new Error('connection reset'),
    )
    const { completeSpy } = mockCronLock(true)

    await expect(expiryService().expireDrafts()).rejects.toThrow(
      'connection reset',
    )

    expect(completeSpy).toHaveBeenCalledTimes(1)
  })
})
