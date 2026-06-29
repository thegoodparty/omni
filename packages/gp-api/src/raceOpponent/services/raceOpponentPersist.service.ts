import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  RaceOpponentSummary,
  RaceOpponentSummarySchema,
  SummarySourceRef,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRun,
  ExperimentRunStatus,
  RaceOpponentSourceType,
} from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CampaignWith } from '@/campaigns/campaigns.types'
import {
  RACE_OPPONENT_COLLECTION,
  RACE_OPPONENT_SUMMARY,
} from '../raceOpponent.constants'
import { RaceOpponentService } from './raceOpponent.service'

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

// The summary artifact (race_opponent_summary output). Each section carries a
// non-empty flat list of source URLs (the @minItems 1 in the output schema);
// the persist below upgrades those URLs to { sourceType, sourceUrl } before
// validating against the contract. Parsed strictly — an artifact whose section
// has no source URL fails here and never persists a partial/unsourced summary.
const ArtifactSummarySectionSchema = z.object({
  text: z.string(),
  sources: z.array(z.string().min(1)).min(1),
})
const ArtifactKeyPositionSchema = z.object({
  label: z.string(),
  detail: z.string(),
  sources: z.array(z.string().min(1)).min(1),
})

// Phase 3 analytical fields. Relaxed sourcing — unlike the descriptive sections
// above, sources are optional (cite where direct), so these parse with or
// without a sources array. Kept optional on the artifact so a summary run that
// predates the analytical instruction still persists its descriptive sections
// rather than failing the whole run mid-rollout.
const ArtifactWhereSoftSchema = z.object({
  text: z.string(),
  sources: z.array(z.string().min(1)).optional(),
})
const ArtifactIssueContrastSchema = z.object({
  issue: z.string(),
  salience: z.enum(['high', 'medium', 'low']),
  why_it_matters: z.string(),
  opponent_stance: z.string(),
  opponent_sources: z.array(z.string().min(1)).optional(),
  candidate_stance: z.string(),
})
const ArtifactSummaryOpponentSchema = z.object({
  opponent_name: z.string(),
  overview: ArtifactSummarySectionSchema.nullable(),
  background: ArtifactSummarySectionSchema.nullable(),
  key_positions: z.array(ArtifactKeyPositionSchema),
  threat_tier: z
    .enum(['primary_threat', 'watch_closely', 'low_priority'])
    .optional(),
  why_they_matter: z.string().optional(),
  what_you_need_to_know: z.array(z.string()).optional(),
  where_soft: z.array(ArtifactWhereSoftSchema).optional(),
  issue_contrasts: z.array(ArtifactIssueContrastSchema).optional(),
})
const ArtifactSummaryEnvelopeSchema = z.object({
  generated_at: z.string(),
  opponents: z.array(ArtifactSummaryOpponentSchema).min(1),
})
type ArtifactSummaryOpponent = z.infer<typeof ArtifactSummaryOpponentSchema>

@Injectable()
export class RaceOpponentPersistService extends createPrismaBase(
  MODELS.RaceOpponent,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly raceOpponent: RaceOpponentService,
  ) {
    super()
  }

  // Queue-consumer hook: route a completed race_opponent run to its handler.
  // No-op for any other experiment type or a non-COMPLETED status.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (run.status !== ExperimentRunStatus.COMPLETED) return
    if (run.experimentType === RACE_OPPONENT_COLLECTION) {
      await this.onCollectionCompleted(run)
    } else if (run.experimentType === RACE_OPPONENT_SUMMARY) {
      await this.onSummaryCompleted(run)
    }
  }

  // A race_opponent_collection run completed. Load its artifact, replace the
  // campaign's collected rows, then chain the summary structuring run so a
  // successful collection automatically produces a fresh summary.
  private async onCollectionCompleted(run: ExperimentRun): Promise<void> {
    const campaign = await this.loadCampaign(run.organizationSlug)
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

      // An empty items array is a valid result per the experiment contract: an
      // opponent with no findable Ballotpedia page or website is the expected
      // down-ballot case, and that "no web footprint" finding is exactly what
      // this collection exists to surface. Leave the run COMPLETED, write
      // nothing, and preserve any prior collection.
      if (envelope.items.length === 0) {
        this.logger.info(
          { runId: run.runId },
          'collection found no web sources; completing with no rows written',
        )
        return
      }

      const items = this.parseItems(run.runId, envelope.items)

      // The artifact carried items but every one failed per-item validation —
      // an agent/contract defect, not a no-data race. Fail the run.
      if (items.length === 0) {
        throw new Error('every artifact item failed per-item validation')
      }

      await this.replaceForCampaign(campaign.id, run.runId, items)
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }

    // Fire-and-forget: the structuring run persists on its own completion
    // event. dispatchSummary reads the rows just committed above and skips when
    // none survived. A dispatch failure must not fail the collection run —
    // the collection's rows are already persisted and the summary can be
    // re-dispatched on the next collection — so log rather than rethrow.
    try {
      await this.raceOpponent.dispatchSummary(campaign)
    } catch (error) {
      this.logger.error(
        { runId: run.runId, error },
        'failed to chain race_opponent_summary dispatch after collection',
      )
    }
  }

  // A race_opponent_summary run completed. Load its artifact, upgrade each
  // section's flat source URLs to { sourceType, sourceUrl } (resolved against
  // the campaign's collected rows), validate against the contract, then
  // idempotently replace the campaign's persisted summaries.
  private async onSummaryCompleted(run: ExperimentRun): Promise<void> {
    const campaign = await this.loadCampaign(run.organizationSlug)
    if (!campaign) return

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
      const envelope = ArtifactSummaryEnvelopeSchema.parse(JSON.parse(raw))

      const sourceTypeByUrl = await this.sourceTypeByUrl(campaign.id)
      const summaries = envelope.opponents.map((opponent) =>
        this.mapSummary(opponent, envelope.generated_at, sourceTypeByUrl),
      )

      await this.replaceSummaries(campaign.id, run.runId, summaries)
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  private loadCampaign(
    organizationSlug: string,
  ): Promise<CampaignWith<'user'> | null> {
    return this.client.campaign.findUnique({
      where: { organizationSlug },
      include: { user: true },
    })
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
  // cleanly rather than accumulating duplicates. The caller guarantees a
  // non-empty items list — the empty cases are handled upstream. The campaign's
  // structured summaries are cleared in the same transaction: they were built
  // from the now-replaced collected text, so leaving them would let GET pair
  // fresh items with stale summary text until the chained summary run lands.
  private async replaceForCampaign(
    campaignId: number,
    runId: string,
    items: ArtifactItem[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.raceOpponent.deleteMany({ where: { campaignId } })
      await tx.raceOpponentSummary.deleteMany({ where: { campaignId } })
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

  // The collected rows are the authority for each URL's source type: the
  // summary artifact carries only flat URLs, and the persisted contract shape
  // pairs each with its type. A URL the artifact cites but no collected row
  // carries can't be a real source (the agent is given only collected URLs), so
  // it falls back to opponent_website rather than dropping the source — the
  // contract requires a type and the URL is still attributable.
  private async sourceTypeByUrl(
    campaignId: number,
  ): Promise<Map<string, RaceOpponentSourceType>> {
    const rows = await this.client.raceOpponent.findMany({
      where: { campaignId },
      select: { sourceUrl: true, sourceType: true },
    })
    const byUrl = new Map<string, RaceOpponentSourceType>()
    for (const row of rows) {
      if (row.sourceUrl) byUrl.set(row.sourceUrl, row.sourceType)
    }
    return byUrl
  }

  // Map one artifact opponent (snake_case, flat string[] sources) into the
  // contract summary shape (camelCase, { sourceType, sourceUrl } sources), then
  // validate against the contract. A section missing a source URL fails the
  // strict envelope parse upstream, so by here every section is sourced; the
  // contract re-validation is the final sourced-or-silent gate before persist.
  private mapSummary(
    opponent: ArtifactSummaryOpponent,
    generatedAt: string,
    sourceTypeByUrl: Map<string, RaceOpponentSourceType>,
  ): RaceOpponentSummary {
    // Sourced-or-silent: a URL the agent cites but no collected row carries
    // was never fetched, so it can't be a real source — drop it rather than
    // inventing a type. If dropping empties a section, the contract's
    // .min(1) below throws, the run is marked FAILED, and nothing persists.
    const refs = (urls: string[]): SummarySourceRef[] =>
      urls.flatMap((url) => {
        const sourceType = sourceTypeByUrl.get(url)
        return sourceType ? [{ sourceType, sourceUrl: url }] : []
      })

    // Relaxed sourcing for the analytical items: drop a URL the collected rows
    // can't type (same as refs), but KEEP the item and omit the sources key
    // entirely when none resolve — these cite where direct, they are never
    // sourced-or-silent like the descriptive sections above.
    const optionalRefs = (urls: string[] | undefined): SummarySourceRef[] =>
      refs(urls ?? [])

    return RaceOpponentSummarySchema.parse({
      opponentName: opponent.opponent_name,
      overview: opponent.overview
        ? {
            text: opponent.overview.text,
            sources: refs(opponent.overview.sources),
          }
        : null,
      background: opponent.background
        ? {
            text: opponent.background.text,
            sources: refs(opponent.background.sources),
          }
        : null,
      keyPositions: opponent.key_positions.map((position) => ({
        label: position.label,
        detail: position.detail,
        sources: refs(position.sources),
      })),
      generatedAt,
      threatTier: opponent.threat_tier,
      whyTheyMatter: opponent.why_they_matter,
      whatYouNeedToKnow: opponent.what_you_need_to_know,
      whereSoft: opponent.where_soft?.map((item) => {
        const sources = optionalRefs(item.sources)
        return { text: item.text, ...(sources.length > 0 ? { sources } : {}) }
      }),
      issueContrasts: opponent.issue_contrasts?.map((contrast) => {
        const opponentSources = optionalRefs(contrast.opponent_sources)
        return {
          issue: contrast.issue,
          salience: contrast.salience,
          whyItMatters: contrast.why_it_matters,
          opponentStance: contrast.opponent_stance,
          candidateStance: contrast.candidate_stance,
          ...(opponentSources.length > 0 ? { opponentSources } : {}),
        }
      }),
    })
  }

  // Idempotent replace-on-persist for summaries: delete the campaign's existing
  // summary rows and re-insert one per opponent in one transaction, keyed by
  // (campaignId, opponentName), so a re-run overwrites cleanly rather than
  // accumulating duplicates.
  private async replaceSummaries(
    campaignId: number,
    runId: string,
    summaries: RaceOpponentSummary[],
  ): Promise<void> {
    // Dedup by opponentName before insert — a non-deterministic LLM can emit
    // the same opponent twice, and createMany would otherwise hit the
    // @@unique([campaignId, opponentName]) constraint and fail an otherwise
    // valid run. Last entry wins.
    const deduped = [
      ...new Map(summaries.map((summary) => [summary.opponentName, summary])),
    ].map(([, summary]) => summary)
    await this.client.$transaction(async (tx) => {
      await tx.raceOpponentSummary.deleteMany({ where: { campaignId } })
      await tx.raceOpponentSummary.createMany({
        data: deduped.map((summary) => ({
          campaignId,
          runId,
          opponentName: summary.opponentName,
          // generatedAt is a coerced Date on the validated object; the JSON
          // column needs a serializable value, and the read path re-coerces
          // the stored ISO string back to a Date via the same schema.
          sections: { ...summary, generatedAt: generatedAtIso(summary) },
        })),
      })
    })
  }
}

const generatedAtIso = (summary: RaceOpponentSummary): string | null =>
  summary.generatedAt ? summary.generatedAt.toISOString() : null
