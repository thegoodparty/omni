import { Injectable } from '@nestjs/common'
import { isAfter } from 'date-fns'
import {
  RaceOpponentActivityResponse,
  RaceOpponentActivityItem,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRunStatus,
  Prisma,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
  RaceOpponentFinding as RaceOpponentFindingRow,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { RaceOpponentService } from './raceOpponent.service'
import { SelfResearchGateService } from './selfResearchGate.service'
import { OPPONENT_RESEARCH } from '../raceOpponent.constants'

const REFRESH_STATUS_MAP: Record<
  ExperimentRunStatus,
  'running' | 'completed' | 'failed'
> = {
  [ExperimentRunStatus.QUEUED]: 'running',
  [ExperimentRunStatus.RUNNING]: 'running',
  [ExperimentRunStatus.AWAITING_RESUME]: 'running',
  [ExperimentRunStatus.SUPERSEDED]: 'running',
  [ExperimentRunStatus.COMPLETED]: 'completed',
  [ExperimentRunStatus.FAILED]: 'failed',
}

@Injectable()
export class RaceOpponentActivityService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly raceOpponent: RaceOpponentService,
    private readonly selfResearchGate: SelfResearchGateService,
  ) {
    super()
  }

  // The "what's new" stream: opponent findings ordered by when they occurred,
  // each flagged for whether it landed since the candidate last looked. Gated
  // identically to the other opponent paths (Pro + a completed
  // self-research pass) so a finding can't leak before research is unlocked.
  // Viewing the stream advances lastViewedAt to now (advanceLastViewedAt) so a
  // subsequent read stops reporting the same items as new — research is NOT
  // refreshed on read.
  async activity(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentActivityResponse> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)

    // Snapshot the view time BEFORE the read so it bounds both the new-since
    // classification and the lastViewedAt we persist. Using a later new Date()
    // for the write would skip any finding created in the gap between read and
    // write — it would be absent from this response yet have the marker advanced
    // past it, so it could never read as new on a later request.
    const now = new Date()

    const rows = await this.model.findMany({
      where: {
        campaignId: campaign.id,
        kind: RaceOpponentFindingKind.opponent,
      },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
      select: {
        status: true,
        lastViewedAt: true,
        findings: true,
      },
    })

    // Authoritative lifecycle from the persisted row, not the ExperimentRun-
    // derived refresh.status (which reports 'running' even when no run exists).
    // With multiple opponent rows, the most-recently-updated one is the active
    // pass the UI cares about; no row at all means research hasn't started.
    const researchStatus: RaceOpponentResearchStatus =
      rows[0]?.status ?? RaceOpponentResearchStatus.not_started

    // The stream is campaign-wide across every opponent row, so the "last
    // visit" reference is the most recent view across them all; the next read's
    // new-since flag keys off that single high-water mark.
    const lastVisit = rows.reduce<Date | null>((latest, row) => {
      if (!row.lastViewedAt) return latest
      if (!latest) return row.lastViewedAt
      return isAfter(row.lastViewedAt, latest) ? row.lastViewedAt : latest
    }, null)

    const findings = rows
      .flatMap((row) => row.findings)
      .sort((a, b) => this.compareFindings(a, b))
      .map((finding) => this.toActivityItem(finding, lastVisit, now))

    const refresh = await this.refreshEnvelope(campaign.organizationSlug)

    // Advancing the view marker is a side effect, not part of the payload, so a
    // failure must not 500 the assembled response — but it MUST commit before we
    // return, or a rapid second GET would re-flag the same items as new
    // (read-after-write race). So await it and swallow only its error.
    try {
      await this.advanceLastViewedAt(campaign.id, now)
    } catch (err) {
      this.logger.error(
        { err, campaignId: campaign.id },
        'failed to advance lastViewedAt for opponent activity stream',
      )
    }

    return { findings, researchStatus, refresh }
  }

  // occurredAt is the primary key (when the event happened); a missing
  // occurredAt sorts after dated findings, with createdAt as the tiebreak so
  // the order is stable for findings that share (or both lack) an occurredAt.
  private compareFindings(
    a: RaceOpponentFindingRow,
    b: RaceOpponentFindingRow,
  ): number {
    const aOccurred = a.occurredAt?.getTime() ?? null
    const bOccurred = b.occurredAt?.getTime() ?? null
    if (aOccurred !== bOccurred) {
      if (aOccurred === null) return 1
      if (bOccurred === null) return -1
      return aOccurred - bOccurred
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  }

  private toActivityItem(
    finding: RaceOpponentFindingRow,
    lastVisit: Date | null,
    now: Date,
  ): RaceOpponentActivityItem {
    return {
      id: finding.id,
      researchId: finding.researchId,
      claim: finding.claim,
      sourceUrl: finding.sourceUrl,
      sourceExtract: finding.sourceExtract,
      sourceTitle: finding.sourceTitle,
      sourceReachableAt: finding.sourceReachableAt,
      category: finding.category,
      occurredAt: finding.occurredAt,
      draftedResponse: finding.draftedResponse,
      createdAt: finding.createdAt,
      newSinceLastVisit: this.isNew(finding, lastVisit, now),
    }
  }

  // A first-ever visit (no prior lastViewedAt) treats everything as new. After
  // that, a finding is new if it occurred or was persisted after the last view.
  // A FUTURE occurredAt (e.g. an upcoming scheduled vote) is not a new-since
  // signal — it would otherwise read as new on every poll forever — so only an
  // already-occurred event counts; otherwise fall back to when we persisted it.
  private isNew(
    finding: RaceOpponentFindingRow,
    lastVisit: Date | null,
    now: Date,
  ): boolean {
    if (!lastVisit) return true
    if (
      finding.occurredAt &&
      !isAfter(finding.occurredAt, now) &&
      isAfter(finding.occurredAt, lastVisit)
    ) {
      return true
    }
    return isAfter(finding.createdAt, lastVisit)
  }

  private async refreshEnvelope(
    organizationSlug: string,
  ): Promise<RaceOpponentActivityResponse['refresh']> {
    const [latestRun, latestCompletedRun] = await Promise.all([
      this.client.experimentRun.findFirst({
        where: { organizationSlug, experimentType: OPPONENT_RESEARCH },
        orderBy: { createdAt: Prisma.SortOrder.desc },
        select: { status: true },
      }),
      this.client.experimentRun.findFirst({
        where: {
          organizationSlug,
          experimentType: OPPONENT_RESEARCH,
          status: ExperimentRunStatus.COMPLETED,
        },
        orderBy: { updatedAt: Prisma.SortOrder.desc },
        select: { updatedAt: true },
      }),
    ])

    return {
      // No run yet defaults to 'running', matching the community-issues feed
      // envelope exactly (the gp-webapp feed component renders both).
      status: latestRun ? REFRESH_STATUS_MAP[latestRun.status] : 'running',
      lastCompletedAt: latestCompletedRun
        ? latestCompletedRun.updatedAt.toISOString()
        : null,
    }
  }

  private async advanceLastViewedAt(
    campaignId: number,
    viewedAt: Date,
  ): Promise<void> {
    // Monotonic advance: a slower concurrent GET with an earlier snapshot must
    // not regress the high-water mark, or findings in the gap re-read as new.
    await this.model.updateMany({
      where: {
        campaignId,
        kind: RaceOpponentFindingKind.opponent,
        OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: viewedAt } }],
      },
      data: { lastViewedAt: viewedAt },
    })
  }
}
