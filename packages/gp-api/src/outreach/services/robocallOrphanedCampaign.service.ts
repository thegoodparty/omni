import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { RobocallOrphanedCampaign } from '../../generated/prisma'

// Which abandonment path recorded an orphaned CallHub campaign.
export type OrphanReason = 'reauth_restage' | 'staging_lost_commit'

// Records + reads the queue of PAUSED CallHub campaigns abandoned before they
// could dial, so the cleanup sweep can ABORT them. Recording is best-effort at
// the call sites (a PAUSED campaign charges nothing, so a lost record only
// leaves harmless account clutter) and idempotent here (upsert by pk_str), so a
// redelivered write collapses to one row.
@Injectable()
export class RobocallOrphanedCampaignService extends createPrismaBase(
  MODELS.RobocallOrphanedCampaign,
) {
  async record(
    campaignPkStr: string,
    outreachId: number | null,
    reason: OrphanReason,
  ): Promise<void> {
    // Upsert, not create: the same pk_str can be recorded more than once (a
    // retried commit path), and it must collapse to a single pending row rather
    // than throw on the unique constraint. Never un-stamp abortedAt on re-record
    // — a campaign already aborted must stay aborted.
    await this.model.upsert({
      where: { campaignPkStr },
      create: { campaignPkStr, outreachId, reason },
      update: {},
    })
  }

  findUnaborted(): Promise<RobocallOrphanedCampaign[]> {
    return this.findMany({ where: { abortedAt: null } })
  }

  // Stamps a row aborted once the sweep has retired the campaign at CallHub.
  // Guarded on abortedAt still null so a concurrent double-sweep marks once.
  async markAborted(id: number): Promise<void> {
    await this.model.updateMany({
      where: { id, abortedAt: null },
      data: { abortedAt: new Date() },
    })
  }
}
