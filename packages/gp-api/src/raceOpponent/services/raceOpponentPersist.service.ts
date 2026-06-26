import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ExperimentRun, ExperimentRunStatus } from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { RACE_OPPONENT_COLLECTION } from '../raceOpponent.constants'

// The collection agent only ever emits these two web-discovered source types;
// campaign_plan_db (the Prisma enum's third value) is reserved for a later
// phase that seeds rows from the Campaign Plan directly, not from an artifact.
const ArtifactItemSchema = z.object({
  opponent_name: z.string(),
  source_type: z.enum(['ballotpedia', 'opponent_website']),
  source_url: z.string(),
  content: z.object({ text: z.string() }),
})

// The envelope is parsed strictly (a non-JSON / no-items artifact is a real
// failure). Items are validated one-by-one below, not here, so a single
// malformed item can't fail an otherwise-good run.
const ArtifactEnvelopeSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
})

type ArtifactItem = z.infer<typeof ArtifactItemSchema>

@Injectable()
export class RaceOpponentPersistService extends createPrismaBase(
  MODELS.RaceOpponent,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly experimentRuns: ExperimentRunsService,
  ) {
    super()
  }

  // Queue-consumer hook: a race_opponent_collection run completed. Load its
  // artifact and replace the campaign's collected rows. No-op for any other
  // experiment type or a non-COMPLETED status.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (run.experimentType !== RACE_OPPONENT_COLLECTION) return
    if (run.status !== ExperimentRunStatus.COMPLETED) return

    const campaign = await this.client.campaign.findUnique({
      where: { organizationSlug: run.organizationSlug },
      select: { id: true },
    })
    if (!campaign) return

    // A COMPLETED run with no artifact can never be persisted; fail it so the
    // derived collection status reports failed rather than sitting completed
    // with stale rows.
    if (!run.artifactBucket || !run.artifactKey) {
      await this.experimentRuns.markFailed(
        run.runId,
        'completed run has no artifact location',
      )
      throw new Error(`run ${run.runId} completed without an artifact location`)
    }

    try {
      const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
      if (!raw) throw new Error('artifact is missing or empty')
      const envelope = ArtifactEnvelopeSchema.parse(JSON.parse(raw))
      await this.replaceForCampaign(
        campaign.id,
        run.runId,
        this.parseItems(run.runId, envelope.items),
      )
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  // Sourced-or-silent (Phase 0): every kept item must carry a non-null
  // source_url. An item that fails per-item validation (e.g. missing URL) is
  // dropped, not fatal — only an unparseable envelope fails the run.
  private parseItems(
    runId: string,
    rawItems: Record<string, unknown>[],
  ): ArtifactItem[] {
    const items: ArtifactItem[] = []
    let dropped = 0
    for (const rawItem of rawItems) {
      const result = ArtifactItemSchema.safeParse(rawItem)
      if (result.success) {
        items.push(result.data)
      } else {
        dropped += 1
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        { runId, dropped, kept: items.length },
        'dropped race opponent artifact items failing per-item validation',
      )
    }
    return items
  }

  // Idempotent replace-on-persist: delete the campaign's existing rows and
  // re-insert from the artifact in one transaction, so a re-run overwrites
  // cleanly rather than accumulating duplicates.
  //
  // Empty items means either the agent found nothing or every item was dropped
  // for failing per-item validation. Either way we keep the prior rows rather
  // than wiping them: a re-collection that yields no trustworthy data must not
  // destroy a campaign's previously-collected opponents.
  private async replaceForCampaign(
    campaignId: number,
    runId: string,
    items: ArtifactItem[],
  ): Promise<void> {
    if (items.length === 0) return
    await this.client.$transaction(async (tx) => {
      await tx.raceOpponent.deleteMany({ where: { campaignId } })
      await tx.raceOpponent.createMany({
        data: items.map((item) => ({
          campaignId,
          runId,
          opponentName: item.opponent_name,
          sourceType: item.source_type,
          sourceUrl: item.source_url,
          content: item.content,
        })),
      })
    })
  }
}
