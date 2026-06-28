import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import http from 'http'
import https from 'https'
import axios, { AxiosError } from 'axios'
import { parseISO, isValid } from 'date-fns'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRun,
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import {
  assertPublicHostname,
  ssrfSafeLookup,
} from '@/websites/services/websites.service'
import {
  DATASET_SOURCE_SCHEMES,
  OPPONENT_RESEARCH,
  SELF_RESEARCH,
} from '../raceOpponent.constants'

const REACHABILITY_TIMEOUT_MS = 10_000

// Self-research findings are sourced-or-silent and carry a drafted response.
const SelfFindingSchema = z.object({
  category: z.string().min(1),
  claim: z.string().min(1),
  drafted_response: z.string().min(1),
  source_extract: z.string().min(1),
  source_url: z.string().min(1),
  source_title: z.string().optional(),
  occurred_at: z.string().nullable().optional(),
})

// Opponent-research findings are sourced-or-silent too, but carry NO drafted
// response (the candidate drafts contrasts separately). source_url is either a
// fetchable http(s) URL (web finding) or a dataset reference like 'l2:...'
// (residency finding) — both are non-empty.
const OpponentFindingSchema = z.object({
  category: z.string().min(1),
  claim: z.string().min(1),
  source_extract: z.string().min(1),
  source_url: z.string().min(1),
  source_title: z.string().optional(),
  occurred_at: z.string().nullable().optional(),
})

// The envelope is parsed strictly (a non-JSON / no-findings artifact is a real
// failure). Findings are validated one-by-one below, not here, so a single
// malformed finding can't fail an otherwise-good run.
const ArtifactEnvelopeSchema = z.object({
  findings: z.array(z.record(z.string(), z.unknown())),
})

type SelfFinding = z.infer<typeof SelfFindingSchema>
type OpponentFinding = z.infer<typeof OpponentFindingSchema>
type ParsedFinding = SelfFinding | OpponentFinding

type ReachableFinding = ParsedFinding & { sourceReachableAt: Date | null }

@Injectable()
export class RaceOpponentResearchPersistService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly experimentRuns: ExperimentRunsService,
  ) {
    super()
  }

  // Queue-consumer hook: a self_research / opponent_research run reached a
  // terminal state. On COMPLETED, load its artifact and replace the matching
  // research row's findings; on FAILED, flip the row to failed with no partial
  // findings. No-op for any other experiment type or a non-terminal status.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    const kind = this.kindForExperiment(run.experimentType)
    if (!kind) return

    if (run.status === ExperimentRunStatus.FAILED) {
      // Swallow a markResearchFailed fault: rethrowing here requeues the
      // message, but the consumer's terminal-status guard (on
      // experimentRun.status) drops the redelivery, so the research row would
      // sit running forever and start() could never re-trigger. Log and move on
      // — the isStuck grace-window backstop is the eventual safety net.
      await this.safeMarkResearchFailed(run.runId, kind)
      return
    }
    if (run.status !== ExperimentRunStatus.COMPLETED) return

    const research = await this.model.findFirst({
      where: { runId: run.runId, kind },
      select: { id: true },
    })
    if (!research) return

    if (!run.artifactBucket || !run.artifactKey) {
      await this.safeMarkResearchFailed(run.runId, kind)
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

      const findings = this.parseFindings(run.runId, kind, envelope.findings)
      const reachable = await this.dropUnreachable(findings)

      await this.replaceFindings(research.id, reachable)
    } catch (error) {
      await this.safeMarkResearchFailed(run.runId, kind)
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  private kindForExperiment(
    experimentType: string,
  ): RaceOpponentFindingKind | null {
    if (experimentType === SELF_RESEARCH) {
      return RaceOpponentFindingKind.self
    }
    if (experimentType === OPPONENT_RESEARCH) {
      return RaceOpponentFindingKind.opponent
    }
    return null
  }

  // markResearchFailed wrapped so a DB fault here can't mask the real error
  // (which we still rethrow) — experimentRuns.markFailed is what flips the run
  // terminal, so the consumer's terminal-status guard bounds redelivery.
  private async safeMarkResearchFailed(
    runId: string,
    kind: RaceOpponentFindingKind,
  ): Promise<void> {
    await this.markResearchFailed(runId, kind).catch((err: unknown) => {
      this.logger.error(
        { err, runId },
        'markResearchFailed threw; research row may remain running',
      )
    })
  }

  private parseFindings(
    runId: string,
    kind: RaceOpponentFindingKind,
    rawFindings: Record<string, unknown>[],
  ): ParsedFinding[] {
    const schema =
      kind === RaceOpponentFindingKind.self
        ? SelfFindingSchema
        : OpponentFindingSchema
    const findings: ParsedFinding[] = []
    let dropped = 0
    for (const rawFinding of rawFindings) {
      const result = schema.safeParse(rawFinding)
      if (result.success) {
        findings.push(result.data)
      } else {
        dropped += 1
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        { runId, kind, dropped, kept: findings.length },
        'dropped research findings failing per-item validation',
      )
    }
    return findings
  }

  // Reachability gate: every kept finding's source_url must resolve to a public
  // host and return < 400. Unreachable findings are dropped (sourced-or-silent
  // extends to "the source must actually exist"). De-duped per URL within a run.
  // Dataset references (e.g. 'l2:...') are NOT http(s) and skip the network
  // check — grounding is the broker's anti-fabrication gate, so they persist
  // with sourceReachableAt set at persist without a fetch.
  private async dropUnreachable(
    findings: ParsedFinding[],
  ): Promise<ReachableFinding[]> {
    const networkUrls = [
      ...new Set(
        findings.map((f) => f.source_url).filter((u) => !this.isDatasetRef(u)),
      ),
    ]
    const reachableAt = new Map<string, Date | null>()
    await Promise.all(
      networkUrls.map(async (url) => {
        reachableAt.set(url, await this.checkReachable(url))
      }),
    )

    const kept: ReachableFinding[] = []
    let dropped = 0
    for (const finding of findings) {
      if (this.isDatasetRef(finding.source_url)) {
        kept.push({ ...finding, sourceReachableAt: new Date() })
        continue
      }
      const at = reachableAt.get(finding.source_url) ?? null
      if (at) {
        kept.push({ ...finding, sourceReachableAt: at })
      } else {
        dropped += 1
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        { dropped, kept: kept.length },
        'dropped research findings with unreachable source_url',
      )
    }
    return kept
  }

  // A dataset reference uses a non-http(s) scheme (e.g. 'l2:...'). Web findings
  // always match ^https?:// per the artifact contract, so scheme is the
  // discriminator — never a network check on an opaque dataset URI.
  private isDatasetRef(sourceUrl: string): boolean {
    return DATASET_SOURCE_SCHEMES.some((scheme) =>
      sourceUrl.toLowerCase().startsWith(scheme),
    )
  }

  // Returns the verification timestamp when the URL is reachable, else null.
  // Uses the SSRF-safe agent (the same one verify-live uses): a finding URL is
  // attacker-influenced agent output, so it must not be able to reach internal
  // hosts. A non-http(s) or unparseable URL is treated as unreachable.
  protected async checkReachable(url: string): Promise<Date | null> {
    let hostname: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null
      }
      hostname = parsed.hostname
    } catch {
      return null
    }

    try {
      await assertPublicHostname(hostname)
      const res = await axios.get(url, {
        timeout: REACHABILITY_TIMEOUT_MS,
        validateStatus: () => true,
        maxRedirects: 5,
        httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
        httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
      })
      return res.status < 400 ? new Date() : null
    } catch (error) {
      const code =
        error instanceof AxiosError ? (error.code ?? error.message) : 'unknown'
      this.logger.debug({ url, code }, 'research source unreachable')
      return null
    }
  }

  // Idempotent replace-on-persist keyed by the research row: delete its existing
  // findings and re-insert in one transaction, then stamp the row completed.
  // A replayed callback (same runId) re-runs cleanly without duplicating.
  // draftedResponse is self-research only; opponent findings carry none.
  private async replaceFindings(
    researchId: number,
    findings: ReachableFinding[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.raceOpponentFinding.deleteMany({ where: { researchId } })
      if (findings.length > 0) {
        await tx.raceOpponentFinding.createMany({
          data: findings.map((f) => ({
            researchId,
            claim: f.claim,
            sourceUrl: f.source_url,
            sourceExtract: f.source_extract,
            sourceTitle: f.source_title ?? null,
            sourceReachableAt: f.sourceReachableAt,
            category: f.category,
            occurredAt: this.parseOccurredAt(f.occurred_at),
            draftedResponse:
              'drafted_response' in f ? f.drafted_response : null,
          })),
        })
      }
      await tx.raceOpponentResearch.update({
        where: { id: researchId },
        data: {
          status: RaceOpponentResearchStatus.completed,
          completedAt: new Date(),
        },
      })
    })
  }

  private parseOccurredAt(raw: string | null | undefined): Date | null {
    if (!raw) return null
    const parsed = parseISO(raw)
    return isValid(parsed) ? parsed : null
  }

  private async markResearchFailed(
    runId: string,
    kind: RaceOpponentFindingKind,
  ): Promise<void> {
    await this.model.updateMany({
      where: { runId, kind },
      data: { status: RaceOpponentResearchStatus.failed },
    })
  }
}
