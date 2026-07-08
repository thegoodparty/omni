import { Injectable } from '@nestjs/common'
import { isBefore, min, parseISO } from 'date-fns'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRun,
  ExperimentRunStatus,
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { FIND_EXISTING_ORDINANCES } from '../ordinances.constants'
import {
  OrdinanceArtifact,
  OrdinanceArtifactSchema,
} from '../schemas/ordinanceArtifact.schema'

const DATA_QUALITY_BY_ARTIFACT: Record<
  OrdinanceArtifact['data_quality'],
  OrdinanceDataQuality
> = {
  ok: OrdinanceDataQuality.OK,
  partial: OrdinanceDataQuality.PARTIAL,
  uncodified: OrdinanceDataQuality.UNCODIFIED,
  not_found: OrdinanceDataQuality.NOT_FOUND,
  ambiguous: OrdinanceDataQuality.AMBIGUOUS,
}

const CONFIDENCE_BY_ARTIFACT: Record<
  OrdinanceArtifact['confidence'],
  OrdinanceConfidence
> = {
  high: OrdinanceConfidence.HIGH,
  medium: OrdinanceConfidence.MEDIUM,
  low: OrdinanceConfidence.LOW,
}

const HOST_TYPE_BY_ARTIFACT: Record<
  NonNullable<OrdinanceArtifact['code_source']>['host_type'],
  OrdinanceHostType
> = {
  municode: OrdinanceHostType.MUNICODE,
  ecode360: OrdinanceHostType.ECODE360,
  american_legal: OrdinanceHostType.AMERICAN_LEGAL,
  codepublishing: OrdinanceHostType.CODEPUBLISHING,
  encodeplus: OrdinanceHostType.ENCODEPLUS,
  municipalcodeonline: OrdinanceHostType.MUNICIPALCODEONLINE,
  city_gov: OrdinanceHostType.CITY_GOV,
  other: OrdinanceHostType.OTHER,
}

const mapCodeSource = (source: OrdinanceArtifact['code_source']) =>
  source
    ? {
        hostType: HOST_TYPE_BY_ARTIFACT[source.host_type],
        url: source.url,
        editionOrDate: source.edition_or_date ?? null,
        clientId: source.client_id ?? null,
        productId: source.product_id ?? null,
      }
    : {
        hostType: null,
        url: null,
        editionOrDate: null,
        clientId: null,
        productId: null,
      }

@Injectable()
export class OrdinanceCodePersistService extends createPrismaBase(
  MODELS.OrdinanceCodeRecord,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly experimentRuns: ExperimentRunsService,
  ) {
    super()
  }

  // Queue-consumer hook (raceOpponentPersist contract): no-op for any other
  // experiment type or non-COMPLETED status; a missing or unpersistable
  // artifact marks the run FAILED and rethrows so the failure surfaces, with
  // redelivery bounded by the consumer's terminal-status guard.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (
      run.experimentType !== FIND_EXISTING_ORDINANCES ||
      run.status !== ExperimentRunStatus.COMPLETED
    ) {
      return
    }

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
      const artifact = OrdinanceArtifactSchema.parse(JSON.parse(raw))
      await this.persistRecord(
        run,
        artifact,
        run.artifactBucket,
        run.artifactKey,
      )
    } catch (error) {
      this.logger.error(
        {
          err: error,
          runId: run.runId,
          organizationSlug: run.organizationSlug,
        },
        'ordinance persist failed; marking run failed',
      )
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  private async persistRecord(
    run: ExperimentRun,
    artifact: OrdinanceArtifact,
    artifactBucket: string,
    artifactKey: string,
  ): Promise<void> {
    // An artifactKey pointing at another run's or org's artifact must never
    // write this org's record, so refuse to persist unless the artifact was
    // generated for exactly this run and org.
    if (artifact.organization_slug !== run.organizationSlug) {
      throw new Error(
        `artifact org ${artifact.organization_slug} does not match ` +
          `run org ${run.organizationSlug}`,
      )
    }
    // the experiment contract sanctions 'unknown' when the runner env lacks
    // RUN_ID; only a concrete mismatching id indicates a mispointed artifact
    if (
      artifact.generated_for_run_id !== 'unknown' &&
      artifact.generated_for_run_id !== run.runId
    ) {
      throw new Error(
        `artifact run ${artifact.generated_for_run_id} does not match ` +
          `run ${run.runId}`,
      )
    }

    const existing = await this.model.findUnique({
      where: { organizationSlug: run.organizationSlug },
      include: { experimentRun: { select: { createdAt: true } } },
    })

    // SQS redelivery replays a result the record already reflects.
    if (existing?.experimentRunId === run.runId) return

    // An older run's late result must never overwrite what a newer run
    // already verified. Compare dispatch times run-to-run — verifiedAt is
    // agent-authored content time and lives on a different clock (the FK is
    // SetNull, so a pruned producing run simply allows the write).
    const producingRunCreatedAt = existing?.experimentRun?.createdAt
    if (
      existing &&
      producingRunCreatedAt &&
      isBefore(run.createdAt, producingRunCreatedAt)
    ) {
      this.logger.info(
        {
          runId: run.runId,
          organizationSlug: run.organizationSlug,
          runCreatedAt: run.createdAt,
          recordRunCreatedAt: producingRunCreatedAt,
        },
        'ordinance persist skipped: run older than current record',
      )
      return
    }

    // Never-regress: a found:false conclusion never erases found data.
    // Record why the current record was kept; the run link stays on the run
    // that actually found the code.
    if (existing?.codeFound && !artifact.code_found) {
      const supersededNote =
        `run ${run.runId} at ${artifact.generated_at} concluded ` +
        `${artifact.data_quality}; record retained`
      if (existing.supersededNote === supersededNote) return
      await this.model.update({
        where: { organizationSlug: run.organizationSlug },
        data: { supersededNote },
      })
      return
    }

    const data = {
      codeFound: artifact.code_found,
      dataQuality: DATA_QUALITY_BY_ARTIFACT[artifact.data_quality],
      confidence: CONFIDENCE_BY_ARTIFACT[artifact.confidence],
      ...mapCodeSource(artifact.code_source),
      place: artifact.jurisdiction.place,
      state: artifact.jurisdiction.state,
      verifiedEvidence: artifact.jurisdiction.verified_evidence,
      artifactBucket,
      artifactKey,
      // Clamp to now: an agent-authored future timestamp must not freeze the
      // org out of its refresh cycle by pushing verifiedAt past every cutoff.
      verifiedAt: min([parseISO(artifact.generated_at), new Date()]),
      experimentRunId: run.runId,
      supersededNote: null,
    }

    await this.model.upsert({
      where: { organizationSlug: run.organizationSlug },
      create: { organizationSlug: run.organizationSlug, ...data },
      update: data,
    })
  }
}
