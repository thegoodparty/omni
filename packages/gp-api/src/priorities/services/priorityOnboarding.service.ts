import { Injectable } from '@nestjs/common'
import type {
  OnboardingPriorityOption,
  SetOnboardingPrioritiesInput,
} from '@goodparty_org/contracts'
import {
  CommunityIssueList,
  Prisma,
  PrioritySource,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import type { SegmentTrackEventProperties } from 'src/vendors/segment/segment.types'
import {
  trackForOffice,
  type PrioritySurface,
} from '../util/priorityAnalytics.util'
import { PrioritiesService } from './priorities.service'

const COMMUNITY_OPTION_LIMIT = 3
const SURFACE: PrioritySurface = 'serve_onboarding'

type OfficeRef = { id: string; organizationSlug: string }

// Option cards carry a one-line byline. A full run's summary runs several
// sentences (facts, then who can act), so the card shows only the first.
const firstSentence = (text: string): string =>
  text.trim().split(/(?<=[.!?])\s+/)[0] ?? ''

@Injectable()
export class PriorityOnboardingService extends createPrismaBase(
  MODELS.Priority,
) {
  constructor(
    private readonly priorities: PrioritiesService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  private topCommunityIssues(organizationSlug: string) {
    return this.client.communityIssue.findMany({
      where: {
        organizationSlug,
        list: CommunityIssueList.top_community,
        archivedAt: null,
      },
      orderBy: [
        { rank: { sort: Prisma.SortOrder.asc, nulls: 'last' } },
        { createdAt: Prisma.SortOrder.asc },
      ],
      take: COMMUNITY_OPTION_LIMIT,
    })
  }

  async options(office: OfficeRef): Promise<OnboardingPriorityOption[]> {
    // Offices created before seeding existed never got their campaign's
    // issues. The seed is idempotent and a no-op without a linked campaign.
    await this.priorities.seedFromWin(office.id)

    const [owned, issues] = await Promise.all([
      this.model.findMany({
        where: {
          electedOfficeId: office.id,
          source: {
            in: [PrioritySource.win_import, PrioritySource.user_stated],
          },
        },
        orderBy: { createdAt: Prisma.SortOrder.asc },
      }),
      this.topCommunityIssues(office.organizationSlug),
    ])

    const fromIssues = await this.model.findMany({
      where: {
        electedOfficeId: office.id,
        sourceCommunityIssueId: { in: issues.map((issue) => issue.id) },
      },
      select: { sourceCommunityIssueId: true, archivedAt: true },
    })
    const prioritizedIssueIds = new Set(
      fromIssues
        .filter((row) => row.archivedAt === null)
        .map((row) => row.sourceCommunityIssueId),
    )

    // Campaign issues always carry over, so they are shown as already on the
    // list rather than offered as a choice. One the official removed later
    // from the Priorities page stays removed.
    const ranOn = owned
      .filter(
        (row) =>
          row.source === PrioritySource.win_import && row.archivedAt === null,
      )
      .map((row) => ({
        key: row.id,
        kind: 'ran_on' as const,
        title: row.title,
        description: firstSentence(row.description),
        selected: true,
      }))
    const community = issues.map((issue) => ({
      key: issue.id,
      kind: 'community' as const,
      title: issue.title,
      description: firstSentence(issue.summary),
      selected: prioritizedIssueIds.has(issue.id),
    }))
    const other = owned
      .filter(
        (row) =>
          row.source === PrioritySource.user_stated && row.archivedAt === null,
      )
      .map((row) => ({
        key: row.id,
        kind: 'other' as const,
        title: row.title,
        description: firstSentence(row.description),
        selected: true,
      }))

    return [...ranOn, ...community, ...other]
  }

  // Campaign issues are never touched here: they carry over regardless of
  // what is picked. Only community issues and typed ones are reconciled, and
  // an unchecked one is archived only if it was on the list the official saw.
  async set(
    office: OfficeRef,
    { shownKeys, selectedKeys, other }: SetOnboardingPrioritiesInput,
  ): Promise<void> {
    const selected = new Set(selectedKeys)
    const shown = new Set(shownKeys)
    const issues = await this.topCommunityIssues(office.organizationSlug)
    const now = new Date()
    const events: [string, SegmentTrackEventProperties][] = []

    await this.client.$transaction(async (tx) => {
      const owned = await tx.priority.findMany({
        where: {
          electedOfficeId: office.id,
          source: {
            in: [PrioritySource.win_import, PrioritySource.user_stated],
          },
        },
      })
      for (const row of owned) {
        if (row.source === PrioritySource.win_import) continue
        const keep = selected.has(row.id)
        if (!keep && !shown.has(row.id)) continue
        if (keep && row.archivedAt !== null) {
          await tx.priority.update({
            where: { id: row.id },
            data: { archivedAt: null },
          })
        } else if (!keep && row.archivedAt === null) {
          await tx.priority.update({
            where: { id: row.id },
            data: { archivedAt: now },
          })
          events.push([
            EVENTS.Priorities.PriorityArchived,
            { priorityId: row.id, surface: SURFACE },
          ])
        }
      }

      for (const issue of issues) {
        // Looked up by issue alone because sourceCommunityIssueId is unique.
        // Issues belong to an org and an org has one office
        // (ElectedOffice.organizationSlug is unique), so a row owned by
        // another office is not reachable here; the guard below is defensive.
        const existing = await tx.priority.findFirst({
          where: { sourceCommunityIssueId: issue.id },
        })
        if (existing && existing.electedOfficeId !== office.id) continue
        const keep = selected.has(issue.id)
        if (!keep && !shown.has(issue.id)) continue
        if (keep && !existing) {
          const created = await tx.priority.create({
            data: {
              electedOfficeId: office.id,
              title: issue.title,
              description: issue.summary,
              source: PrioritySource.community_issue,
              sourceCommunityIssueId: issue.id,
            },
          })
          events.push([
            EVENTS.Priorities.PriorityCreated,
            {
              priorityId: created.id,
              source: PrioritySource.community_issue,
              communityIssueId: issue.id,
              surface: SURFACE,
            },
          ])
        } else if (keep && existing?.archivedAt) {
          await tx.priority.update({
            where: { id: existing.id },
            data: { archivedAt: null },
          })
        } else if (!keep && existing && existing.archivedAt === null) {
          await tx.priority.update({
            where: { id: existing.id },
            data: { archivedAt: now },
          })
          events.push([
            EVENTS.Priorities.PriorityArchived,
            { priorityId: existing.id, surface: SURFACE },
          ])
        }
      }

      const liveTitles = new Set(
        owned
          .filter((row) =>
            row.source === PrioritySource.win_import
              ? row.archivedAt === null
              : selected.has(row.id) ||
                (row.archivedAt === null && !shown.has(row.id)),
          )
          .map((row) => row.title.trim().toLowerCase()),
      )
      for (const { title, description } of other) {
        const normalized = title.toLowerCase()
        if (liveTitles.has(normalized)) continue
        liveTitles.add(normalized)
        const created = await tx.priority.create({
          data: {
            electedOfficeId: office.id,
            title,
            description,
            source: PrioritySource.user_stated,
          },
        })
        events.push([
          EVENTS.Priorities.PriorityCreated,
          {
            priorityId: created.id,
            source: PrioritySource.user_stated,
            surface: SURFACE,
          },
        ])
      }
    })

    await trackForOffice(this.client, this.analytics, { id: office.id }, events)
  }
}
