import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'
import { OutreachDraftService } from './outreachDraft.service'
import { DRAFT_RETENTION_DAYS } from './outreachDraftExpiry.service'

const service = useTestService({ jobs: true })

const ORG_SLUG = 'draft-expiry-org'

beforeEach(async () => {
  await service.prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { slug: ORG_SLUG, ownerId: service.user.id },
    update: {},
  })
})

const createDraft = (createdAt: Date) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.draft,
      createdAt,
    },
  })

describe('the outreachDraftExpiry schedule', () => {
  afterEach(() => vi.restoreAllMocks())

  it('deletes a draft older than the retention window', async () => {
    const stale = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )

    await service.jobs.runSchedule('outreachDraftExpiry')

    expect(
      await service.prisma.outreach.findUnique({ where: { id: stale.id } }),
    ).toBeNull()
  })

  it('keeps a draft inside the retention window', async () => {
    const fresh = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS - 1),
    )

    await service.jobs.runSchedule('outreachDraftExpiry')

    expect(
      await service.prisma.outreach.findUnique({ where: { id: fresh.id } }),
    ).not.toBeNull()
  })

  it('keeps a draft resumed while its job ran', async () => {
    const resumed = await createDraft(
      subDays(new Date(), DRAFT_RETENTION_DAYS + 1),
    )
    // A candidate converts the row (draft -> pending_payment) after the
    // schedule found it and before its outreachDraftExpire job reads it.
    const drafts = service.app.get(OutreachDraftService)
    const realDeleteDraftRow = drafts.deleteDraftRow.bind(drafts)
    vi.spyOn(drafts, 'deleteDraftRow').mockImplementation(async (row) => {
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { status: OutreachStatus.pending_payment },
      })
      return realDeleteDraftRow(row)
    })

    await service.jobs.runSchedule('outreachDraftExpiry')

    const row = await service.prisma.outreach.findUnique({
      where: { id: resumed.id },
    })
    expect(row?.status).toBe(OutreachStatus.pending_payment)
  })

  it('expires the other drafts when one fails, and dead-letters that one', async () => {
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

    const { deadLetters } = await service.jobs.runSchedule(
      'outreachDraftExpiry',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'outreachDraftExpire',
        data: { outreachId: failing.id },
        error: 'boom',
      },
    ])
    expect(
      await service.prisma.outreach.findUnique({ where: { id: failing.id } }),
    ).not.toBeNull()
    expect(
      await service.prisma.outreach.findUnique({
        where: { id: succeeding.id },
      }),
    ).toBeNull()
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
