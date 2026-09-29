import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
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

  it('keeps a draft that was resumed before the job ran', async () => {
    const resumed = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    // Sequential stand-in for the race: a candidate can convert this row
    // (draft -> pending_payment) between the job's scan and its per-row
    // delete. Sequencing create -> resume -> run stands in for that
    // interleaving without needing real concurrency.
    await service.prisma.outreach.update({
      where: { id: resumed.id },
      data: { status: OutreachStatus.pending_payment },
    })
    mockCronLock(true)

    await expiryService().expireDrafts()

    const row = await service.prisma.outreach.findUnique({
      where: { id: resumed.id },
    })
    expect(row).not.toBeNull()
    expect(row?.status).toBe(OutreachStatus.pending_payment)
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

  it('does not seal the lease when the scan itself throws', async () => {
    // Sealing on a scan failure would defeat the stale-claim takeover the
    // lock provides, losing the whole day's sweep.
    vi.spyOn(service.prisma.outreach, 'findMany').mockRejectedValue(
      new Error('connection reset'),
    )
    const { completeSpy } = mockCronLock(true)

    await expect(expiryService().expireDrafts()).rejects.toThrow(
      'connection reset',
    )

    expect(completeSpy).not.toHaveBeenCalled()
  })
})

describe('OutreachDraftService.deleteDraftRow — draft guard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses a row that is no longer a draft, deleting nothing', async () => {
    const converted = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    await service.prisma.outreach.update({
      where: { id: converted.id },
      data: {
        status: OutreachStatus.pending_payment,
        imageUrl: `https://${ASSET_DOMAIN}/some/live/image.png`,
      },
    })
    const drafts = service.app.get(OutreachDraftService)
    const s3 = service.app.get(S3Service)
    const deleteObject = vi
      .spyOn(s3, 'deleteObject')
      .mockResolvedValue(undefined)

    // Called directly with a stale (pre-resume) row, the way the expiry
    // job's scan would hand it a row that has since been converted.
    await drafts.deleteDraftRow({
      ...converted,
      status: OutreachStatus.pending_payment,
      imageUrl: `https://${ASSET_DOMAIN}/some/live/image.png`,
      robocall: null,
    })

    expect(deleteObject).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: converted.id },
      }),
    ).not.toBeNull()
  })

  it('resolves when the asset cleanup fails after the row is gone', async () => {
    const draft = await createDraft(subDays(new Date(), 1))
    await service.prisma.outreach.update({
      where: { id: draft.id },
      data: { imageUrl: `https://${ASSET_DOMAIN}/some/draft/image.png` },
    })
    const drafts = service.app.get(OutreachDraftService)
    const s3 = service.app.get(S3Service)
    vi.spyOn(s3, 'deleteObject').mockRejectedValue(
      new Error('Token is expired'),
    )

    // The row delete is the only irreversible step and it succeeded; an
    // orphaned object is the lesser harm and must not read as a failed delete.
    await expect(
      drafts.deleteDraftRow({
        ...draft,
        imageUrl: `https://${ASSET_DOMAIN}/some/draft/image.png`,
        robocall: null,
      }),
    ).resolves.toBeUndefined()
    expect(
      await service.prisma.outreach.findUnique({ where: { id: draft.id } }),
    ).toBeNull()
  })
})
