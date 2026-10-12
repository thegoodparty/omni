import { Injectable } from '@nestjs/common'
import { Prisma, PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AnalyticsService } from '@/analytics/analytics.service'
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
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  listActive(electedOfficeId: string) {
    return this.model.findMany({
      where: { electedOfficeId, archivedAt: null },
      orderBy: { createdAt: Prisma.SortOrder.asc },
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
    return count === 0
      ? null
      : this.model.findFirst({ where: { id, electedOfficeId } })
  }

  async archive(id: string, electedOfficeId: string, surface: PrioritySurface) {
    const { count } = await this.model.updateMany({
      where: { id, electedOfficeId, archivedAt: null },
      data: { archivedAt: new Date() },
    })
    if (count === 0) return false
    await trackForOffice(this.client, this.analytics, { id: electedOfficeId }, [
      [EVENTS.Priorities.PriorityArchived, { priorityId: id, surface }],
    ])
    return true
  }

  async seedFromWin(electedOfficeId: string, tx?: TxClient): Promise<void> {
    const client = tx ?? this.client

    const office = await client.electedOffice.findUnique({
      where: { id: electedOfficeId },
      select: { campaignId: true },
    })
    if (!office?.campaignId) return

    const existing = await client.priority.findFirst({
      where: { electedOfficeId, source: PrioritySource.win_import },
      select: { id: true },
    })
    if (existing) return

    const campaign = await client.campaign.findUnique({
      where: { id: office.campaignId },
      select: {
        details: true,
        campaignPositions: {
          select: {
            id: true,
            description: true,
            position: { select: { name: true } },
            topIssue: { select: { name: true } },
          },
        },
      },
    })
    if (!campaign) return

    const customIssues = campaign.details?.customIssues ?? []
    const rows: Prisma.PriorityCreateManyInput[] =
      customIssues.length > 0
        ? customIssues.map((issue) => ({
            electedOfficeId,
            title: issue.title,
            description: issue.position,
            source: PrioritySource.win_import,
            sourceCampaignPositionId: null,
          }))
        : campaign.campaignPositions.map((cp) => ({
            electedOfficeId,
            title: cp.position.name ?? cp.topIssue?.name ?? '',
            description: cp.description ?? '',
            source: PrioritySource.win_import,
            sourceCampaignPositionId: cp.id,
          }))

    if (rows.length === 0) return

    await client.priority.createMany({ data: rows })
  }
}
