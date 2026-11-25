import { Injectable } from '@nestjs/common'
import { parseISO } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import type { JobRun } from '@/jobs/jobs.registry'
import { JobShutdownError, JobsService } from '@/jobs/jobs.service'
import {
  caseScoutEnabled,
  ESTIMATED_COST_PER_CALL_USD,
  spendCapUsd,
} from '../caseScout.config'
import {
  ScoreStatus,
  type Manifest,
  type ManifestSession,
  type SessionScore,
} from '../schemas/caseScoutBucket.schema'
import {
  MAX_REASON_LENGTH,
  MAX_SUMMARY_LENGTH,
  type ScoreResponse,
} from '../schemas/caseScoutModel.schema'
import { renderSessionTranscript } from '../util/transcript.util'
import { CaseScoutBucketService } from './caseScoutBucket.service'
import { CaseScoutMessagesService } from './caseScoutMessages.service'
import {
  CaseScoutModelService,
  ScoreParseError,
} from './caseScoutModel.service'

// A parse failure is retried once in the same attempt, as Samuel's digest
// does; a call failure is left to the job's own retries.
const SCORE_PARSE_ATTEMPTS = 2

export type ScoreSessionJob = { runId: string; sessionId: string }

// The caseScoutScoreSession job: one Opus call for one session, its result
// written to runs/<runId>/scores/<sessionId>.json.
@Injectable()
export class CaseScoutScoreService {
  constructor(
    private readonly bucket: CaseScoutBucketService,
    private readonly messages: CaseScoutMessagesService,
    private readonly model: CaseScoutModelService,
    private readonly jobs: JobsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaseScoutScoreService.name)
  }

  async scoreSession(job: JobRun<ScoreSessionJob>): Promise<void> {
    if (!caseScoutEnabled()) return
    const { runId, sessionId } = job.data
    const manifest = await this.bucket.readManifest(runId)
    const session = manifest?.sessions.find((s) => s.sessionId === sessionId)
    if (!manifest || !session) {
      throw new Error(`case scout run ${runId} has no session ${sessionId}`)
    }

    if (!(await this.bucket.readScore(runId, sessionId))) {
      await this.bucket.writeScore(await this.score(job, manifest, session))
    }
    await this.queueDraftWhenAllScored(manifest)
  }

  private async score(
    job: JobRun<ScoreSessionJob>,
    manifest: Manifest,
    session: ManifestSession,
  ): Promise<SessionScore> {
    const { runId, sessionId } = job.data
    // The cap is read from the night's running total in the bucket, since the
    // score jobs run on several tasks at once. Each of the up to
    // maxConcurrent jobs in flight can read the total just under the cap, so
    // the score stage can overshoot by that many calls (4 x $0.75 = $3.00
    // estimated), against one call in the Python reader.
    const spent = (await this.bucket.readScores(runId)).reduce(
      (total, score) => total + score.costUsd,
      0,
    )
    if (spent > spendCapUsd()) {
      return { runId, sessionId, status: ScoreStatus.spendCapped, costUsd: 0 }
    }

    const messages = await this.messages.readByIds(session.messageIds)
    if (messages.length === 0) {
      return {
        runId,
        sessionId,
        status: ScoreStatus.failed,
        error: `session ${sessionId}: its messages are no longer readable`,
        costUsd: 0,
      }
    }
    const transcript = renderSessionTranscript({
      sessionId,
      conversationId: session.conversationId,
      scope: session.scope,
      startedAt: parseISO(session.startedAt),
      messages,
    })

    let lastParseError: ScoreParseError | undefined
    for (let attempt = 0; attempt < SCORE_PARSE_ATTEMPTS; attempt++) {
      try {
        const response = await this.model.scoreTranscript(
          session.scope,
          transcript,
          job.signal,
        )
        if (response.requests.length > 0) {
          return this.scored(runId, sessionId, response)
        }
        lastParseError = new ScoreParseError('scoring response had no requests')
      } catch (err) {
        if (!(err instanceof ScoreParseError)) {
          // The last attempt leaves a failed score behind, so a dead-lettered
          // session cannot keep the night from drafting. A timeout also
          // aborts the signal and spends the attempt; only a shutdown
          // requeues it, so only a shutdown skips the failed score.
          if (
            job.retryCount >= job.retryLimit &&
            !(job.signal.reason instanceof JobShutdownError)
          ) {
            await this.bucket.writeScore({
              runId,
              sessionId,
              status: ScoreStatus.failed,
              error: `session ${sessionId}: scoring call failed`,
              costUsd: ESTIMATED_COST_PER_CALL_USD,
            })
            await this.queueDraftWhenAllScored(manifest)
          }
          throw err
        }
        lastParseError = err
      }
    }
    return {
      runId,
      sessionId,
      status: ScoreStatus.failed,
      error:
        `session ${sessionId}: scoring response could not be parsed after ` +
        `retry (${lastParseError?.message ?? 'unknown'})`,
      costUsd: ESTIMATED_COST_PER_CALL_USD,
    }
  }

  private scored(
    runId: string,
    sessionId: string,
    response: ScoreResponse,
  ): SessionScore {
    const requests = response.requests.map((request) => ({
      requestOrdinal: request.request_ordinal,
      primaryUseCase: request.primary_use_case,
      answeredRequest: request.answered_request,
      overallRating: request.overall_rating,
      majorFailureType: request.major_failure_type,
      knownPattern: request.known_pattern,
      severity: request.severity,
      confidence: request.confidence,
      humanReviewNeeded: request.human_review_needed,
      worthQuotingAnonymized: request.worth_quoting_anonymized,
      summaryNonidentifying: request.summary_nonidentifying.slice(
        0,
        MAX_SUMMARY_LENGTH,
      ),
      reasonNonidentifying: request.reason_nonidentifying.slice(
        0,
        MAX_REASON_LENGTH,
      ),
    }))
    return {
      runId,
      sessionId,
      status: ScoreStatus.scored,
      severity: Math.max(...requests.map((request) => request.severity)),
      requests,
      costUsd: ESTIMATED_COST_PER_CALL_USD,
    }
  }

  // Every finished score job checks; the job key is the run, so two that
  // finish together still queue one draft job.
  private async queueDraftWhenAllScored(manifest: Manifest): Promise<void> {
    const scored = new Set(
      (await this.bucket.readScores(manifest.runId)).map((s) => s.sessionId),
    )
    if (!manifest.scoredSessionIds.every((id) => scored.has(id))) return
    await this.jobs.sendMany('caseScoutDraft', [
      { data: { runId: manifest.runId }, key: manifest.runId },
    ])
    this.logger.info(
      { runId: manifest.runId, sessions: scored.size },
      'Case scout night scored; drafting queued',
    )
  }
}
