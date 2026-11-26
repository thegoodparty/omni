import { Injectable } from '@nestjs/common'
import { addMilliseconds } from 'date-fns'
import { Prisma, PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { MarketingRevalidationService } from '@/personProfiles/services/marketing-revalidation.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import {
  trackForOffice,
  type PrioritySurface,
} from '../util/priorityAnalytics.util'

export type CreatePriorityData = {
  title: string
  description: string
}

export type UpdatePriorityData = {
  title?: string
  description?: string
}

type TxClient = Prisma.TransactionClient

@Injectable()
export class PrioritiesService extends createPrismaBase(MODELS.Priority) {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly revalidation: MarketingRevalidationService,
  ) {
    super()
  }

  listActive(electedOfficeId: string) {
    return this.model.findMany({
      where: { electedOfficeId, archivedAt: null },
      orderBy: [
        { focusedAt: { sort: Prisma.SortOrder.desc, nulls: 'last' } },
        { createdAt: Prisma.SortOrder.asc },
      ],
    })
  }

  async create(
    electedOfficeId: string,
    data: CreatePriorityData,
    source: PrioritySource,
    surface: PrioritySurface,
  ) {
    const created = await this.model.create({
      data: {
        electedOfficeId,
        title: data.title,
        description: data.description,
        source,
      },
    })
    await trackForOffice(this.client, this.analytics, { id: electedOfficeId }, [
      [
        EVENTS.Priorities.PriorityCreated,
        { priorityId: created.id, source, surface },
      ],
    ])
    return created
  }

  async update(id: string, electedOfficeId: string, patch: UpdatePriorityData) {
    const { count } = await this.model.updateMany({
      where: { id, electedOfficeId, archivedAt: null },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
      },
    })
    if (count === 0) return null
    await this.revalidatePublishingProfiles(id)
    return this.model.findFirst({ where: { id, electedOfficeId } })
  }

  async archive(id: string, electedOfficeId: string, surface: PrioritySurface) {
    const { count } = await this.model.updateMany({
      where: { id, electedOfficeId, archivedAt: null },
      data: { archivedAt: new Date() },
    })
    if (count === 0) return false
    await this.revalidatePublishingProfiles(id)
    await trackForOffice(this.client, this.analytics, { id: electedOfficeId }, [
      [EVENTS.Priorities.PriorityArchived, { priorityId: id, surface }],
    ])
    return true
  }

  // A priority its owner published on their public profile is shown there
  // under its own title and description, so that page re-renders when the
  // priority changes.
  private async revalidatePublishingProfiles(priorityId: string) {
    const profiles = await this.client.personProfile.findMany({
      where: {
        publishedAt: { not: null },
        deletedAt: null,
        issues: { some: { issueId: priorityId } },
      },
      select: { personId: true },
    })
    await Promise.all(
      profiles.map(({ personId }) =>
        this.revalidation.revalidatePerson(personId, []),
      ),
    )
  }

  // The offices whose onboarding priorities step will offer issues they ran
  // on: rows seedFromWin already copied, or, for an office it has not seeded
  // yet, a linked campaign with something for it to copy.
  async officesWithWinIssues(
    offices: { id: string; campaignId: number | null }[],
  ): Promise<Set<string>> {
    const linked = offices.filter(
      (office): office is { id: string; campaignId: number } =>
        office.campaignId !== null,
    )
    if (linked.length === 0) return new Set()

    const imported = await this.model.findMany({
      where: {
        electedOfficeId: { in: linked.map((office) => office.id) },
        source: PrioritySource.win_import,
      },
      select: { electedOfficeId: true, archivedAt: true },
    })
    const seeded = new Set(imported.map((row) => row.electedOfficeId))
    const result = new Set(
      imported
        .filter((row) => row.archivedAt === null)
        .map((row) => row.electedOfficeId),
    )

    const unseeded = linked.filter((office) => !seeded.has(office.id))
    if (unseeded.length === 0) return result

    const campaigns = await this.client.campaign.findMany({
      where: { id: { in: unseeded.map((office) => office.campaignId) } },
      select: {
        id: true,
        details: true,
        _count: { select: { campaignPositions: true } },
      },
    })
    const withSource = new Set(
      campaigns
        .filter(
          (campaign) =>
            (campaign.details?.customIssues?.length ?? 0) > 0 ||
            campaign._count.campaignPositions > 0,
        )
        .map((campaign) => campaign.id),
    )
    for (const office of unseeded) {
      if (withSource.has(office.campaignId)) result.add(office.id)
    }
    return result
  }

  // Copies what the candidate ran on into the office's priorities: every
  // picked position, oldest first, then every typed issue in the order typed.
  // Safe to call again: it adds only what is missing, so an office seeded
  // when typed issues hid the positions gets those positions on its next
  // call. A finished office keeps the list it has.
  async seedFromWin(electedOfficeId: string, tx?: TxClient): Promise<void> {
    const missing = await this.missingWinRows(
      tx ?? this.client,
      electedOfficeId,
    )
    if (missing.length === 0) return

    // The welcome's read and the onboarding job both seed, at once for a
    // winner landing on the flow, and no unique key stops a second copy.
    const write = async (inner: TxClient) => {
      const lockKey = `priority_seed:${electedOfficeId}`
      await inner.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      const rows = await this.missingWinRows(inner, electedOfficeId)
      if (rows.length > 0) await inner.priority.createMany({ data: rows })
    }
    await (tx ? write(tx) : this.client.$transaction(write))
  }

  private async missingWinRows(
    client: TxClient,
    electedOfficeId: string,
  ): Promise<Prisma.PriorityCreateManyInput[]> {
    const office = await client.electedOffice.findUnique({
      where: { id: electedOfficeId },
      select: { campaignId: true, onboardingCompletedAt: true },
    })
    if (!office?.campaignId) return []

    // Archived rows count: one the official removed stays removed.
    const seeded = await client.priority.findMany({
      where: { electedOfficeId, source: PrioritySource.win_import },
      select: { sourceCampaignPositionId: true },
    })
    if (seeded.length > 0 && office.onboardingCompletedAt !== null) return []

    const campaign = await client.campaign.findUnique({
      where: { id: office.campaignId },
      select: {
        details: true,
        campaignPositions: {
          orderBy: [
            { createdAt: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
          select: {
            id: true,
            description: true,
            position: { select: { name: true } },
            topIssue: { select: { name: true } },
          },
        },
      },
    })
    if (!campaign) return []

    const seededPositionIds = new Set(
      seeded.map((row) => row.sourceCampaignPositionId),
    )
    // A typed issue has no id to match on, so they are copied together, once.
    const typedSeeded = seededPositionIds.has(null)
    const rows = [
      ...campaign.campaignPositions
        .filter((cp) => !seededPositionIds.has(cp.id))
        .map((cp) => ({
          title: cp.position.name ?? cp.topIssue?.name ?? '',
          description: cp.description ?? '',
          sourceCampaignPositionId: cp.id,
        })),
      ...(typedSeeded ? [] : (campaign.details?.customIssues ?? [])).map(
        (issue) => ({
          title: issue.title,
          description: issue.position,
          sourceCampaignPositionId: null,
        }),
      ),
    ]

    // One insert stamps every row with the same time, which would leave the
    // order they were added in undefined.
    const now = new Date()
    return rows.map((row, index) => ({
      ...row,
      electedOfficeId,
      source: PrioritySource.win_import,
      createdAt: addMilliseconds(now, index),
    }))
  }
}
