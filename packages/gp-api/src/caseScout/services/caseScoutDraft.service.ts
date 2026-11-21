import { Injectable } from '@nestjs/common'
import { compareAsc, parseISO } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import type { JobRun } from '@/jobs/jobs.registry'
import {
  CANDIDATE_MIN_SEVERITY,
  caseScoutEnabled,
  COVERED_SCOPES,
  ESTIMATED_COST_PER_CALL_USD,
  spendCapUsd,
} from '../caseScout.config'
import { SCORING_MODEL } from '../caseScout.prompts'
import {
  DraftOutcome,
  ScoreStatus,
  type Bundle,
  type BundleDraft,
  type LedgerLine,
  type Manifest,
  type ManifestSession,
  type RunRecord,
  type Sources,
} from '../schemas/caseScoutBucket.schema'
import {
  MAX_FAILURE_SUMMARY_LENGTH,
  type DraftResponse,
} from '../schemas/caseScoutModel.schema'
import { nightlyCapForMergeShare, trailingMergeShare } from '../util/cap.util'
import {
  buildDraftedCase,
  buildDraftingPrompt,
  draftCandidate,
  DraftingError,
} from '../util/drafting.util'
import {
  gateDraft,
  gateNeedsSetup,
  WITHHELD_NEEDS_SETUP,
  type SecondReadCall,
} from '../util/gate.util'
import {
  findDuplicate,
  findRejection,
  monthKeysCovering,
  RECENT_PROPOSALS_WINDOW_DAYS,
  recentProposalsForAgent,
  type LedgerEntry,
} from '../util/ledger.util'
import {
  newMarkerCandidate,
  sessionsSafeToMarkProcessed,
  type Session,
} from '../util/sessions.util'
import { sessionDenylist, sessionSourceTexts } from '../util/transcript.util'
import { CaseScoutBucketService } from './caseScoutBucket.service'
import {
  CaseScoutCaseListsService,
  LIST_SOFT_CAP,
  type CaseListInfo,
} from './caseScoutCaseLists.service'
import { CaseScoutMessagesService } from './caseScoutMessages.service'
import { CaseScoutModelService } from './caseScoutModel.service'
import { CaseScoutPublisherService } from './caseScoutPublisher.service'

export type DraftNightJob = { runId: string }

type Candidate = { session: ManifestSession; severity: number }

type Spend = { score: number; draft: number; gate: number }

type NightOutput = {
  bundle: Bundle
  sources: Sources
  ledgerLines: LedgerLine[]
  record: RunRecord
}

const totalOf = (spend: Spend): number => spend.score + spend.draft + spend.gate

// The caseScoutDraft job: picks the night's worst sessions, drafts and gates
// them one at a time (a night's drafts must not duplicate each other), writes
// the night's files and hands them to the publisher.
//
// Safe to run twice. bundle.json is written last, so its presence means the
// night's sources, ledger lines and record are all written; a retry then only
// re-invokes the publisher, and not even that once the marker names this run.
// The publisher is idempotent for a run (an existing PR is reused, the marker
// moves once), except that it posts its Slack note again. A retry before
// bundle.json exists drafts from scratch: nothing it wrote is read back, and
// its ledger lines replace the earlier attempt's.
@Injectable()
export class CaseScoutDraftService {
  constructor(
    private readonly bucket: CaseScoutBucketService,
    private readonly messages: CaseScoutMessagesService,
    private readonly model: CaseScoutModelService,
    private readonly caseLists: CaseScoutCaseListsService,
    private readonly publisher: CaseScoutPublisherService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CaseScoutDraftService.name)
  }

  async draftNight(job: JobRun<DraftNightJob>): Promise<void> {
    if (!caseScoutEnabled()) return
    const { runId } = job.data

    if (await this.bucket.readBundle(runId)) {
      const marker = await this.bucket.readMarker()
      if (marker.updatedByRun === runId) {
        this.logger.info({ runId }, 'Case scout night already published')
        return
      }
      await this.publisher.publish(runId)
      return
    }

    const manifest = await this.bucket.readManifest(runId)
    if (!manifest) throw new Error(`case scout run ${runId} has no manifest`)

    const night = await this.draft(job, manifest, new Date())
    await this.bucket.writeSources(runId, night.sources)
    await this.bucket.replaceRunLedgerLines(
      runId.slice(0, 7),
      runId,
      night.ledgerLines,
    )
    await this.bucket.writeRecord(night.record)
    await this.bucket.writeBundle(night.bundle)

    if (night.record.spendCapHit) {
      this.logger.warn(
        { runId, spendUsd: night.record.spendUsd.total },
        'Case scout spend cap hit',
      )
    }
    this.logger.info(
      { runId, counts: night.record.counts },
      'Case scout night drafted',
    )
    await this.publisher.publish(runId)
  }

  private async draft(
    job: JobRun<DraftNightJob>,
    manifest: Manifest,
    now: Date,
  ): Promise<NightOutput> {
    const { runId } = manifest
    const createdAt = now.toISOString()
    const scores = new Map(
      (await this.bucket.readScores(runId)).map((s) => [s.sessionId, s]),
    )
    const errors: string[] = []
    const scoringErrors: string[] = []
    const spendCapped = new Set<string>()
    const spend: Spend = { score: 0, draft: 0, gate: 0 }
    const candidates: Candidate[] = []

    for (const session of manifest.sessions) {
      if (!COVERED_SCOPES.has(session.scope)) continue
      const score = scores.get(session.sessionId)
      spend.score += score?.costUsd ?? 0
      if (!score) {
        scoringErrors.push(`session ${session.sessionId}: no score`)
      } else if (score.status === ScoreStatus.spendCapped) {
        scoringErrors.push(
          `session ${session.sessionId}: skipped, spend cap reached`,
        )
        spendCapped.add(session.sessionId)
      } else if (score.status === ScoreStatus.failed) {
        scoringErrors.push(score.error)
      } else if (score.severity >= CANDIDATE_MIN_SEVERITY) {
        candidates.push({ session, severity: score.severity })
      }
    }
    candidates.sort(
      (a, b) =>
        b.severity - a.severity ||
        compareAsc(
          parseISO(a.session.startedAt),
          parseISO(b.session.startedAt),
        ),
    )

    // This run's own lines from an earlier attempt are not history: they
    // would read tonight's proposals as duplicates of themselves.
    const history = (
      await this.bucket.readLedgerEntries(
        monthKeysCovering(now, RECENT_PROPOSALS_WINDOW_DAYS),
      )
    ).filter((entry) => entry.runId !== runId)
    const nightlyCap = nightlyCapForMergeShare(trailingMergeShare(history, now))
    const working: LedgerEntry[] = [...history]
    const caseLists = new Map<string, CaseListInfo>()
    const spendCap = spendCapUsd()
    const secondRead: SecondReadCall = (text) =>
      this.model.secondRead(text, job.signal)

    const drafts: BundleDraft[] = []
    const needsSetup: Bundle['needsSetup'] = []
    const listFull: BundleDraft[] = []
    const sources: Sources = {}
    const ledgerLines: LedgerLine[] = []
    let drafted = 0

    const line = (
      candidate: Candidate,
      outcome: DraftOutcome,
      fields: Partial<
        Pick<
          LedgerLine,
          | 'caseId'
          | 'coveredBy'
          | 'needsSetup'
          | 'failureSummary'
          | 'gateFailures'
        >
      > = {},
    ): LedgerLine => {
      const entry: LedgerLine = {
        runId,
        conversationId: candidate.session.conversationId,
        sessionId: candidate.session.sessionId,
        agentId: candidate.session.scope,
        severity: candidate.severity,
        outcome,
        caseId: fields.caseId ?? null,
        coveredBy: fields.coveredBy ?? null,
        needsSetup: fields.needsSetup ?? null,
        gateFailures: fields.gateFailures ?? [],
        prNumber: null,
        failureSummary: fields.failureSummary ?? '',
        createdAt,
      }
      ledgerLines.push(entry)
      return entry
    }

    for (const candidate of candidates) {
      if (job.signal.aborted) {
        throw new Error(`case scout drafting for ${runId} was interrupted`)
      }
      const agentId = candidate.session.scope
      if (totalOf(spend) > spendCap) {
        line(candidate, DraftOutcome.spendCapped)
        spendCapped.add(candidate.session.sessionId)
        continue
      }
      if (drafted >= nightlyCap) {
        line(candidate, DraftOutcome.capped)
        continue
      }

      const caseList =
        caseLists.get(agentId) ??
        (await this.caseLists.readOrEmpty(agentId, errors))
      caseLists.set(agentId, caseList)

      const messages = await this.messages.readByIds(
        candidate.session.messageIds,
      )
      if (messages.length === 0) {
        line(candidate, DraftOutcome.error, {
          failureSummary: 'the session is no longer readable',
        })
        continue
      }
      const session: Session = {
        sessionId: candidate.session.sessionId,
        conversationId: candidate.session.conversationId,
        scope: agentId,
        startedAt: parseISO(candidate.session.startedAt),
        messages,
      }

      let result: DraftResponse
      try {
        result = await draftCandidate(
          this.model,
          session,
          buildDraftingPrompt({
            agentId,
            fixtureDescription: caseList.fixtureDescription,
            currentConditions: caseList.conditions,
            recentProposals: recentProposalsForAgent(working, agentId, now),
          }),
          job.signal,
        )
      } catch (err) {
        if (!(err instanceof DraftingError)) throw err
        drafted++
        spend.draft += ESTIMATED_COST_PER_CALL_USD
        line(candidate, DraftOutcome.error, {
          failureSummary: err.message.slice(0, MAX_FAILURE_SUMMARY_LENGTH),
        })
        continue
      }
      drafted++
      spend.draft += ESTIMATED_COST_PER_CALL_USD
      const { failureSummary } = result

      if (result.outcome === 'coveredBy') {
        line(candidate, DraftOutcome.covered, {
          coveredBy: result.caseId,
          failureSummary,
        })
        continue
      }
      if (result.outcome === 'needsSetup') {
        const gate = await gateNeedsSetup(
          result.what,
          sessionDenylist(session),
          sessionSourceTexts(session),
          secondRead,
        )
        spend.gate += ESTIMATED_COST_PER_CALL_USD
        const what = gate.passed ? result.what : WITHHELD_NEEDS_SETUP
        needsSetup.push({ agentId, severity: candidate.severity, what })
        line(candidate, DraftOutcome.needsSetup, {
          needsSetup: what,
          failureSummary,
          gateFailures: gate.passed ? [] : [gate.rule],
        })
        continue
      }

      const { conversationId } = candidate.session
      const duplicate = findDuplicate(
        working,
        conversationId,
        agentId,
        failureSummary,
        now,
      )
      if (duplicate) {
        line(candidate, DraftOutcome.covered, {
          coveredBy: duplicate.caseId ?? null,
          failureSummary,
        })
        continue
      }
      const rejection = findRejection(
        working,
        conversationId,
        agentId,
        failureSummary,
        now,
      )
      if (rejection) {
        line(candidate, DraftOutcome.suppressed, {
          caseId: rejection.caseId ?? null,
          failureSummary,
        })
        continue
      }

      const draftedCase = buildDraftedCase(result.case)

      // The prompt never shows the model the raw caseId list, so a collision
      // with main or with tonight's earlier draft is caught here.
      if (
        caseList.caseIds.has(draftedCase.caseId) ||
        draftedCase.caseId in sources
      ) {
        line(candidate, DraftOutcome.error, {
          failureSummary:
            `caseId ${draftedCase.caseId} collides with an existing or ` +
            'already-proposed case',
        })
        continue
      }

      // After the checks above, which drop a candidate whatever the gate
      // says, so the gate's paid second read is never spent on one.
      const gate = await gateDraft(
        draftedCase,
        sessionDenylist(session),
        sessionSourceTexts(session),
        secondRead,
      )
      spend.gate += ESTIMATED_COST_PER_CALL_USD
      if (!gate.passed) {
        line(candidate, DraftOutcome.gated, {
          caseId: draftedCase.caseId,
          failureSummary: gate.reason,
          gateFailures: [gate.rule],
        })
        continue
      }

      const bundled = {
        agentId,
        severity: candidate.severity,
        case: draftedCase,
        failureSummary,
      }
      if (caseList.caseCount >= LIST_SOFT_CAP) {
        listFull.push(bundled)
        line(candidate, DraftOutcome.listFull, {
          caseId: draftedCase.caseId,
          failureSummary,
        })
        continue
      }

      drafts.push(bundled)
      sources[draftedCase.caseId] = {
        conversationId,
        sessionId: candidate.session.sessionId,
      }
      const proposed = line(candidate, DraftOutcome.proposed, {
        caseId: draftedCase.caseId,
        failureSummary,
      })
      working.push({
        runId,
        conversationId,
        agentId,
        outcome: proposed.outcome,
        caseId: proposed.caseId ?? undefined,
        failureSummary,
        createdAt: now,
        closedAt: undefined,
      })
      caseLists.set(agentId, {
        ...caseList,
        caseCount: caseList.caseCount + 1,
      })
    }

    const outcomes = (outcome: DraftOutcome) =>
      ledgerLines.filter((entry) => entry.outcome === outcome).length
    const newMarker = newMarkerCandidate(
      manifest.oldMarker,
      sessionsSafeToMarkProcessed(
        manifest.sessions.map((s) => ({
          sessionId: s.sessionId,
          startedAt: parseISO(s.startedAt),
        })),
        spendCapped,
      ),
    )

    return {
      bundle: { runId, drafts, needsSetup, listFull, removals: [] },
      sources,
      ledgerLines,
      record: {
        runId,
        startedAt: manifest.startedAt,
        finishedAt: createdAt,
        counts: {
          sessions: manifest.sessions.length,
          scored: manifest.sessions.length - scoringErrors.length,
          candidates: ledgerLines.length,
          proposed: outcomes(DraftOutcome.proposed),
          covered: outcomes(DraftOutcome.covered),
          needsSetup: outcomes(DraftOutcome.needsSetup),
          gated: outcomes(DraftOutcome.gated),
          capped: outcomes(DraftOutcome.capped),
          spendCapped: outcomes(DraftOutcome.spendCapped),
          listFull: outcomes(DraftOutcome.listFull),
        },
        spendUsd: { ...spend, total: totalOf(spend) },
        spendCapHit: totalOf(spend) > spendCap,
        model: SCORING_MODEL,
        errors: [...scoringErrors, ...errors],
        newMarker,
      },
    }
  }
}
