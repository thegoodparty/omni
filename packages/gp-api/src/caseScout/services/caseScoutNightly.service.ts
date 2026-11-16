import { Injectable } from '@nestjs/common'
import { addMinutes, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { PinoLogger } from 'nestjs-pino'
import { JobsService } from '@/jobs/jobs.service'
import {
  caseScoutEnabled,
  COVERED_SCOPES,
  filtersInternalAccounts,
  sessionCap,
} from '../caseScout.config'
import type { Manifest } from '../schemas/caseScoutBucket.schema'
import {
  QUERY_OVERLAP_MINUTES,
  segmentIntoSessions,
  selectNewSessions,
} from '../util/sessions.util'
import { CaseScoutBucketService } from './caseScoutBucket.service'
import { CaseScoutMessagesService } from './caseScoutMessages.service'

// The caseScoutNightly schedule: claim the night, read the chats since the
// marker, split them into sessions and send one score job per session.
@Injectable()
export class CaseScoutNightlyService {
  constructor(
    private readonly bucket: CaseScoutBucketService,
    private readonly messages: CaseScoutMessagesService,
    private readonly jobs: JobsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaseScoutNightlyService.name)
  }

  async runNight(): Promise<void> {
    if (!caseScoutEnabled()) {
      this.logger.info('Case scout is off; skipping the night')
      return
    }
    const now = new Date()
    const runId = formatInTimeZone(now, 'UTC', 'yyyy-MM-dd')

    const claim = await this.bucket.claimNight(runId)
    if (claim === 'taken') {
      this.logger.info({ runId }, 'Case scout night already claimed elsewhere')
      return
    }

    const manifest =
      (await this.bucket.readManifest(runId)) ??
      (await this.bucket.createManifest(await this.buildManifest(runId, now)))

    if (manifest.scoredSessionIds.length === 0) {
      await this.jobs.sendMany('caseScoutDraft', [
        { data: { runId }, key: runId },
      ])
    } else {
      await this.jobs.sendMany(
        'caseScoutScoreSession',
        manifest.scoredSessionIds.map((sessionId) => ({
          data: { runId, sessionId },
          key: `${sessionId}:${runId}`,
        })),
      )
    }
    this.logger.info(
      {
        runId,
        sessions: manifest.sessions.length,
        toScore: manifest.scoredSessionIds.length,
        cappedCount: manifest.cappedCount,
        excludedProcessedCount: manifest.excludedProcessedCount,
      },
      'Case scout night fanned out',
    )
  }

  private async buildManifest(runId: string, now: Date): Promise<Manifest> {
    const marker = await this.bucket.readMarker()
    const lastSessionStart = marker.lastSessionStart ?? null
    const windowStart = lastSessionStart
      ? addMinutes(parseISO(lastSessionStart), -QUERY_OVERLAP_MINUTES)
      : null
    const isInternalFilter = filtersInternalAccounts()
    const messages = await this.messages.readSince(
      windowStart,
      isInternalFilter,
    )
    const processedSessionIds = marker.processedSessionIds ?? []
    const { kept, excludedProcessedCount, cappedCount } = selectNewSessions(
      segmentIntoSessions(messages),
      processedSessionIds,
      sessionCap(),
    )
    return {
      runId,
      startedAt: now.toISOString(),
      windowStart: windowStart?.toISOString() ?? null,
      isInternalFilter,
      excludedProcessedCount,
      cappedCount,
      oldMarker: { lastSessionStart, processedSessionIds },
      sessions: kept.map((session) => ({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        scope: session.scope,
        startedAt: session.startedAt.toISOString(),
        messageIds: session.messages.map((message) => message.messageId),
      })),
      scoredSessionIds: kept
        .filter((session) => COVERED_SCOPES.has(session.scope))
        .map((session) => session.sessionId),
    }
  }
}
