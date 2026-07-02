import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  NormalizedSummarySource,
  RaceOpponentFieldAnalysis,
  RaceOpponentFieldAnalysisSchema,
  RaceOpponentSummary,
  RaceOpponentSummarySchema,
  RaceOpponentThreatTierSchema,
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

// The summary artifact (race_opponent_summary v2 output). Rich sources carry
// title/publisher/description alongside the url so the UI can render a source
// carousel without a second fetch. Descriptive sections (overview, background,
// issues_that_matter) require >=1 source at the artifact level; mapSummary
// below re-applies sourced-or-silent against the campaign's actually-collected
// URLs and nulls a section that loses every source to that check, rather than
// failing the run.
const ArtifactRichSourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  description: z.string().optional(),
})
type ArtifactRichSource = z.infer<typeof ArtifactRichSourceSchema>

const ArtifactDescriptiveSectionSchema = z.object({
  text: z.string(),
  sources: z.array(ArtifactRichSourceSchema).min(1),
})
type ArtifactDescriptiveSection = z.infer<
  typeof ArtifactDescriptiveSectionSchema
>

const ArtifactIssuesThatMatterSchema = z.object({
  items: z.array(z.string()).min(1),
  sources: z.array(ArtifactRichSourceSchema).min(1),
})
type ArtifactIssuesThatMatter = z.infer<typeof ArtifactIssuesThatMatterSchema>

const ArtifactWhyTheyreRunningSchema = z.object({ text: z.string() })

// Campaign-level SWOT. Interpretive: bullets carry no required source, so
// sources is the relaxed path (kept, just filtered) rather than sourced-or-
// silent — an empty sources array never nulls the section.
const ArtifactFieldAnalysisSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  opportunities: z.array(z.string()),
  threats: z.array(z.string()),
  sources: z.array(ArtifactRichSourceSchema),
})
type ArtifactFieldAnalysis = z.infer<typeof ArtifactFieldAnalysisSchema>

const ArtifactSummaryOpponentSchema = z.object({
  opponent_name: z.string(),
  // The v2 output schema requires this, but a v1 run dispatched before this
  // deploy (v1 emitted the tier optionally) can complete after it, and
  // ExperimentRun carries no manifest-version discriminator to branch on — a
  // missing tier must not fail the whole run.
  threat_tier: RaceOpponentThreatTierSchema.optional(),
  overview: ArtifactDescriptiveSectionSchema.nullable().optional(),
  why_theyre_running: ArtifactWhyTheyreRunningSchema.nullable().optional(),
  background: ArtifactDescriptiveSectionSchema.nullable().optional(),
  issues_that_matter: ArtifactIssuesThatMatterSchema.nullable().optional(),
})
type ArtifactSummaryOpponent = z.infer<typeof ArtifactSummaryOpponentSchema>

const ArtifactSummaryEnvelopeSchema = z.object({
  generated_at: z.string(),
  opponents: z.array(ArtifactSummaryOpponentSchema).min(1),
  field_analysis: ArtifactFieldAnalysisSchema.nullable().optional(),
})

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

  // Queue-consumer hook: route a terminal race_opponent run to its handler.
  // No-op for any other experiment type. Collection persists on COMPLETED only.
  // A summary is handled on BOTH terminal states: COMPLETED persists the
  // analysis, and either outcome re-chains a summary for a newer collection its
  // in-flight dedup skipped — a FAILED summary that skipped the re-chain would
  // otherwise strand collectionStatus on 'running' forever (ENG-10614).
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (run.experimentType === RACE_OPPONENT_COLLECTION) {
      if (run.status === ExperimentRunStatus.COMPLETED) {
        await this.onCollectionCompleted(run)
      }
    } else if (run.experimentType === RACE_OPPONENT_SUMMARY) {
      if (run.status === ExperimentRunStatus.COMPLETED) {
        await this.onSummaryCompleted(run)
      } else if (run.status === ExperimentRunStatus.FAILED) {
        await this.onSummaryFailed(run)
      }
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

  // A race_opponent_summary run completed. Load its artifact, resolve each
  // rich source's URL against the campaign's collected rows, validate against
  // the contract, then idempotently replace the campaign's persisted summaries
  // and campaign-level field analysis.
  private async onSummaryCompleted(run: ExperimentRun): Promise<void> {
    const campaign = await this.loadCampaign(run.organizationSlug)
    if (!campaign) return

    // The re-chain must fire on EVERY terminal outcome of this run — a clean
    // persist, a missing artifact, or an artifact that fails processing — so it
    // sits in a finally. Without it, the throw paths below would skip the re-
    // chain and strand collectionStatus on 'running' when a newer collection is
    // waiting on the summary this run's dedup skipped (ENG-10614).
    try {
      if (!run.artifactBucket || !run.artifactKey) {
        await this.experimentRuns.markFailed(
          run.runId,
          'completed run has no artifact location',
        )
        throw new Error(
          `run ${run.runId} completed without an artifact location`,
        )
      }

      try {
        const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
        if (!raw) throw new Error('artifact is missing or empty')
        const envelope = ArtifactSummaryEnvelopeSchema.parse(JSON.parse(raw))

        const sourceTypeByUrl = await this.sourceTypeByUrl(campaign.id)
        const summaries = envelope.opponents.map((opponent) =>
          this.mapSummary(opponent, envelope.generated_at, sourceTypeByUrl),
        )
        const fieldAnalysis = envelope.field_analysis
          ? this.mapFieldAnalysis(
              envelope.field_analysis,
              envelope.generated_at,
              sourceTypeByUrl,
            )
          : null

        await this.replaceSummaries(
          campaign.id,
          run.runId,
          summaries,
          fieldAnalysis,
        )
      } catch (error) {
        await this.experimentRuns.markFailed(
          run.runId,
          error instanceof Error ? error.message : String(error),
        )
        throw error
      }
    } finally {
      await this.rechainAfterSummary(campaign, run.createdAt)
    }
  }

  // A race_opponent_summary run FAILED at the queue level (no artifact to
  // persist). Still re-chain: a newer collection may be waiting on the summary
  // this run's in-flight dedup skipped.
  private async onSummaryFailed(run: ExperimentRun): Promise<void> {
    const campaign = await this.loadCampaign(run.organizationSlug)
    if (!campaign) return
    await this.rechainAfterSummary(campaign, run.createdAt)
  }

  // Fire-and-forget re-chain, run on every terminal summary outcome. A dispatch
  // failure must not fail an already-persisted (or already-terminal) run — the
  // next collection re-chains — so log rather than rethrow. Placed in a finally
  // by onSummaryCompleted, so it must never throw or it would mask the original
  // persist error the caller re-raises for redelivery visibility.
  private async rechainAfterSummary(
    campaign: CampaignWith<'user'>,
    summaryRunCreatedAt: Date,
  ): Promise<void> {
    try {
      await this.raceOpponent.rechainSummaryForNewerCollection(
        campaign,
        summaryRunCreatedAt,
      )
    } catch (error) {
      this.logger.error(
        { error },
        'failed to re-chain race_opponent_summary after a newer collection',
      )
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
  // structured summaries AND field analysis are cleared in the same
  // transaction: both were built from the now-replaced collected text, so
  // leaving either would let GET pair fresh items with stale analysis until
  // the chained summary run lands — indefinitely, if that run fails.
  private async replaceForCampaign(
    campaignId: number,
    runId: string,
    items: ArtifactItem[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.raceOpponent.deleteMany({ where: { campaignId } })
      await tx.raceOpponentSummary.deleteMany({ where: { campaignId } })
      await tx.raceOpponentFieldAnalysis.deleteMany({ where: { campaignId } })
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

  // Sourced-or-silent (v2): drop a source whose URL no collected row carries —
  // the agent is given only collected URLs, so an uncollected one was never
  // fetched and can't be a real source. Kept sources carry the transitional
  // sourceUrl/sourceType passthrough: the deployed webapp still reads
  // source.sourceUrl until the UI tickets (ENG-10635) move it to the rich
  // shape, so a freshly regenerated summary must not break its source links
  // during the rollout window.
  private resolveSources(
    sources: ArtifactRichSource[],
    sourceTypeByUrl: Map<string, RaceOpponentSourceType>,
  ): NormalizedSummarySource[] {
    return sources.flatMap((source) => {
      const sourceType = sourceTypeByUrl.get(source.url)
      if (!sourceType) return []
      return [
        {
          url: source.url,
          title: source.title,
          publisher: source.publisher,
          ...(source.description ? { description: source.description } : {}),
          sourceUrl: source.url,
          sourceType,
        },
      ]
    })
  }

  // Map one artifact opponent (snake_case, rich sources) into the contract
  // summary shape (camelCase), then validate against the contract. A
  // descriptive section that loses every source to resolveSources becomes
  // null (silent) rather than failing the run — the artifact-level .min(1)
  // above only guarantees the agent cited *something*, not that it was
  // actually collected.
  private mapSummary(
    opponent: ArtifactSummaryOpponent,
    generatedAt: string,
    sourceTypeByUrl: Map<string, RaceOpponentSourceType>,
  ): RaceOpponentSummary {
    const descriptiveSection = (
      section: ArtifactDescriptiveSection | null | undefined,
    ) => {
      if (!section) return null
      const sources = this.resolveSources(section.sources, sourceTypeByUrl)
      return sources.length > 0 ? { text: section.text, sources } : null
    }

    // Unlike overview/background (contract-required, always coerced to null),
    // issuesThatMatter is nullish on the contract — an artifact that never
    // emits the key stays undefined rather than being forced to null.
    const issuesThatMatter = (
      section: ArtifactIssuesThatMatter | null | undefined,
    ) => {
      if (section === undefined) return undefined
      if (section === null) return null
      const sources = this.resolveSources(section.sources, sourceTypeByUrl)
      return sources.length > 0 ? { items: section.items, sources } : null
    }

    return RaceOpponentSummarySchema.parse({
      opponentName: opponent.opponent_name,
      overview: descriptiveSection(opponent.overview),
      background: descriptiveSection(opponent.background),
      generatedAt,
      threatTier: opponent.threat_tier,
      whyTheyreRunning: opponent.why_theyre_running,
      issuesThatMatter: issuesThatMatter(opponent.issues_that_matter),
      // Transitional: the deployed webapp reads keyPositions.length unguarded,
      // so a persisted summary must carry the key until ENG-10635 migrates the
      // UI off it — then drop this.
      keyPositions: [],
    })
  }

  // Campaign-level SWOT: interpretive bullets persist regardless of sourcing,
  // only the sources list is filtered (the relaxed path, unlike
  // descriptiveSection's sourced-or-silent null-out above).
  private mapFieldAnalysis(
    fieldAnalysis: ArtifactFieldAnalysis,
    generatedAt: string,
    sourceTypeByUrl: Map<string, RaceOpponentSourceType>,
  ): RaceOpponentFieldAnalysis {
    return RaceOpponentFieldAnalysisSchema.parse({
      strengths: fieldAnalysis.strengths,
      weaknesses: fieldAnalysis.weaknesses,
      opportunities: fieldAnalysis.opportunities,
      threats: fieldAnalysis.threats,
      sources: this.resolveSources(fieldAnalysis.sources, sourceTypeByUrl),
      generatedAt,
    })
  }

  // Idempotent replace-on-persist for summaries: delete the campaign's existing
  // summary rows and re-insert one per opponent in one transaction, keyed by
  // (campaignId, opponentName), so a re-run overwrites cleanly rather than
  // accumulating duplicates. The campaign-level field analysis shares the
  // transaction: upserted (one row per campaignId) when the artifact carries
  // one, deleted when the artifact's field_analysis is null (e.g. the
  // campaign has no candidate_platform yet).
  private async replaceSummaries(
    campaignId: number,
    runId: string,
    summaries: RaceOpponentSummary[],
    fieldAnalysis: RaceOpponentFieldAnalysis | null,
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

      if (fieldAnalysis) {
        const sections = {
          ...fieldAnalysis,
          generatedAt: generatedAtIso(fieldAnalysis),
        }
        await tx.raceOpponentFieldAnalysis.upsert({
          where: { campaignId },
          create: { campaignId, runId, sections },
          update: { runId, sections },
        })
      } else {
        await tx.raceOpponentFieldAnalysis.deleteMany({ where: { campaignId } })
      }
    })
  }
}

// Shared by both RaceOpponentSummary and RaceOpponentFieldAnalysis — both
// carry a coerced Date generatedAt that needs re-serializing for the Json
// column.
const generatedAtIso = (value: { generatedAt: Date | null }): string | null =>
  value.generatedAt ? value.generatedAt.toISOString() : null
