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
  // identically to the other opponent paths (Pro + flag + a completed
  // self-research pass) so a finding can't leak before research is unlocked.
  // Viewing the stream advances lastViewedAt to now (advanceLastViewedAt) so a
  // subsequent read stops reporting the same items as new — research is NOT
  // refreshed on read.
  async activity(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentActivityResponse> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)

    const rows = await this.model.findMany({
      where: {
        campaignId: campaign.id,
        kind: RaceOpponentFindingKind.opponent,
      },
      select: {
        lastViewedAt: true,
        findings: true,
      },
    })

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
      .map((finding) => this.toActivityItem(finding, lastVisit))

    const refresh = await this.refreshEnvelope(campaign.organizationSlug)

    // Advancing the view marker is a side effect, not part of the payload. A
    // failure here must not 500 a fully-assembled response; the worst case is
    // the next read re-flags the same items as new. Fire-and-forget with a log.
    void this.advanceLastViewedAt(campaign.id).catch((err: unknown) => {
      this.logger.error(
        { err, campaignId: campaign.id },
        'failed to advance lastViewedAt for opponent activity stream',
      )
    })

    return { findings, refresh }
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
      newSinceLastVisit: this.isNew(finding, lastVisit),
    }
  }

  // A first-ever visit (no prior lastViewedAt) treats everything as new. After
  // that, a finding is new if it occurred or was persisted after the last view.
  private isNew(
    finding: RaceOpponentFindingRow,
    lastVisit: Date | null,
  ): boolean {
    if (!lastVisit) return true
    if (finding.occurredAt && isAfter(finding.occurredAt, lastVisit)) {
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
      status: latestRun ? REFRESH_STATUS_MAP[latestRun.status] : 'completed',
      lastCompletedAt: latestCompletedRun
        ? latestCompletedRun.updatedAt.toISOString()
        : null,
    }
  }

  private async advanceLastViewedAt(campaignId: number): Promise<void> {
    await this.model.updateMany({
      where: { campaignId, kind: RaceOpponentFindingKind.opponent },
      data: { lastViewedAt: new Date() },
    })
  }
}
