import { Injectable, NotFoundException } from '@nestjs/common'
import { subHours } from 'date-fns'
import {
  Campaign,
  Prisma,
  TcrCompliance,
  TcrComplianceStatus,
  User,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { INTERNAL_EMAIL_SUFFIXES } from '../../../users/util/users.util'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import {
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE,
} from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { CampaignTcrComplianceService } from './campaignTcrCompliance.service'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'
import { sleep } from 'src/shared/util/sleep.util'

// The scan owns every scheduled Peerly retrieve_cv read. Cadence, set size,
// and pacing were agreed with Peerly (James/Patrick, 2026-08-17): poll only
// identities still awaiting a CV transition, twice a day, at an absolute rate
// of 1 retrieve_cv call per minute across all identities. The cvStatusScan
// schedule (src/jobs/jobs.registry.ts) runs it, once per slot fleet-wide.

// The fresh-submission fast poll: CV usually approves within hours of
// submit_cv and emails/texts the PIN immediately, but the twice-daily scan
// meant the "your PIN is on the way" HubSpot notice could lag ~12h — often
// firing after the candidate had already entered the PIN. Polling only the
// records submitted in the last FRESH_WINDOW_HOURS (a handful at any time,
// FRESH_SCAN_RECORD_CAP as the runaway backstop) every 30 minutes stays
// within spitting distance of the vendor-agreed budget; a slot overlapping
// a running full scan can transiently reach 2 calls/min, bounded by the cap.
// The cvStatusFreshScan schedule runs it.
const FRESH_WINDOW_HOURS = 48
const FRESH_SCAN_RECORD_CAP = 15

// Peerly's requested absolute rate limit for retrieve_cv: 1 call/minute
// regardless of identity (60 identities take 60 minutes). Env-overridable so
// tests can zero it out; `parseInt(x) || default` so a non-numeric value
// falls back instead of NaN reaching sleep().
const RETRIEVE_CV_SPACING_MS =
  parseInt(process.env.CV_SCAN_RETRIEVE_SPACING_MS ?? '') || 60_000

// getProfile is not rate-limited; this spacing only keeps the profile pass
// from bursting (matches the old nightly-poll spacing).
const PROFILE_READ_SPACING_MS =
  parseInt(process.env.CV_SCAN_PROFILE_SPACING_MS ?? '') || 350

// At 1 call/minute a full-cap CV pass takes ~5 hours — comfortably inside the
// 12-hour slot. The steady-state in-flight set is a few dozen records; the
// cap is a runaway backstop, and records past it (oldest-touched poll first)
// get their turn next slot.
const SCAN_RECORD_CAP = 300

// Only Pro, non-internal registrations are live Peerly work — pre-payment
// records sit idle by design and staff walk-throughs are noise (mirrors the
// nightly report's scoping).
const scannableCampaign = {
  isPro: true,
  user: {
    NOT: INTERNAL_EMAIL_SUFFIXES.map((suffix) => ({
      email: { endsWith: suffix, mode: Prisma.QueryMode.insensitive },
    })),
  },
}

type RecordWithCampaignUser = TcrCompliance & {
  campaign: Campaign & { user: User | null }
}

@Injectable()
export class CvStatusPollService extends createPrismaBase(
  MODELS.TcrCompliance,
) {
  constructor(
    private readonly peerlyIdentityService: PeerlyIdentityService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
  ) {
    super()
  }

  // The cvStatusScan schedule's worker (src/jobs/jobs.registry.ts).
  async runScheduledScan(job: JobRun<ScheduleData>): Promise<void> {
    // VENDOR_CRONS_ENABLED: a non-prod deploy in live mode would run real
    // retrieve_cv calls, and every call counts against the vendor budget this
    // scan exists to respect. Where Peerly is mocked the scan is safe to run,
    // so it does.
    if (!VENDOR_CRONS_ENABLED) {
      return
    }
    await this.runScan(job.id, job.signal)
  }

  // The cvStatusFreshScan schedule's worker.
  async runScheduledFreshScan(job: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) {
      return
    }
    await this.runFreshScan(job.id, { signal: job.signal })
  }

  // The fast-lane counterpart of runScan: same per-record pipeline
  // (pollCvRecord → applyCvDetection → status persist), same pacing, but
  // scoped to recent submissions that have no PIN detected yet — the window
  // where a prompt CompliancePinSent actually changes what the candidate
  // gets told. Everything older stays on the twice-daily scan's budget.
  //
  // `opts.campaignId` narrows the pass to one campaign (the
  // cvStatusFreshScanCampaign job, so a spec on a shared preview DB never
  // polls other users' records) and bypasses the Pro/internal-email scoping,
  // since fixture users are internal by design. `opts.spacingMs` overrides
  // the per-record retrieve_cv pacing; that job passes 0 so one record does
  // not sleep 60s. On `opts.signal` (shutdown) the pass stops and the rest
  // waits for the next slot.
  async runFreshScan(
    scanKey: string,
    opts: {
      campaignId?: number
      spacingMs?: number
      signal?: AbortSignal
    } = {},
  ) {
    const spacingMs = opts.spacingMs ?? RETRIEVE_CV_SPACING_MS
    const freshCandidates: RecordWithCampaignUser[] = await this.model.findMany(
      {
        where: {
          campaign:
            opts.campaignId === undefined
              ? scannableCampaign
              : { id: opts.campaignId },
          internalTestingAt: null,
          peerlyIdentityId: { not: null },
          pinSentDetectedAt: null,
          peerlySubmissionStartedAt: {
            gte: subHours(new Date(), FRESH_WINDOW_HOURS),
          },
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          OR: [
            { peerlyCvStatus: null },
            {
              peerlyCvStatus: {
                in: [
                  PeerlyCvVerificationStatus.REQUESTED,
                  PeerlyCvVerificationStatus.IN_REVIEW,
                  PeerlyCvVerificationStatus.APPROVED,
                ],
              },
            },
          ],
        },
        include: { campaign: { include: { user: true } } },
        orderBy: { updatedAt: Prisma.SortOrder.asc },
      },
    )
    if (freshCandidates.length > FRESH_SCAN_RECORD_CAP) {
      this.logger.warn(
        {
          total: freshCandidates.length,
          polled: FRESH_SCAN_RECORD_CAP,
          scanKey,
        },
        '[CV fresh poll] Fresh backlog exceeds per-scan cap',
      )
    }
    for (const record of freshCandidates.slice(0, FRESH_SCAN_RECORD_CAP)) {
      if (opts.signal?.aborted) {
        this.logger.info(
          { scanKey },
          '[CV fresh poll] Stopped for shutdown; the next slot polls the rest',
        )
        return
      }
      try {
        await this.pollCvRecord(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id, scanKey },
          '[CV fresh poll] CV poll failed for record',
        )
      }
      await sleep(spacingMs, opts.signal)
    }
    this.logger.info(
      {
        scanKey,
        freshPolled: Math.min(freshCandidates.length, FRESH_SCAN_RECORD_CAP),
      },
      '[CV fresh poll] Fresh scan complete',
    )
  }

  // On `signal` (shutdown) the scan stops and the rest waits for the next
  // slot; records poll oldest-touched first, so the tail is not starved.
  async runScan(scanKey: string, signal?: AbortSignal) {
    // Pre-VERIFIED, non-terminal registrations are the only identities a
    // retrieve_cv read can still move: null (submitted, no status observed
    // yet — a persisting null past the first scan is a dropped submission,
    // surfaced by the nightly report's case-1 section), REQUESTED/IN_REVIEW
    // (waiting on CV), and APPROVED (PIN issued, awaiting entry — the read
    // also carries the PIN delivery channel and catches late rejections).
    // VERIFIED and rejected/withdrawn records never re-enter the set:
    // everything after VERIFIED is tracked via getProfile below.
    const cvCandidates: RecordWithCampaignUser[] = await this.model.findMany({
      where: {
        campaign: scannableCampaign,
        internalTestingAt: null,
        peerlyIdentityId: { not: null },
        status: {
          in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
        },
        OR: [
          { peerlyCvStatus: null },
          {
            peerlyCvStatus: {
              in: [
                PeerlyCvVerificationStatus.REQUESTED,
                PeerlyCvVerificationStatus.IN_REVIEW,
                PeerlyCvVerificationStatus.APPROVED,
              ],
            },
          },
        ],
      },
      include: { campaign: { include: { user: true } } },
      orderBy: { updatedAt: Prisma.SortOrder.asc },
    })
    if (cvCandidates.length > SCAN_RECORD_CAP) {
      this.logger.warn(
        { total: cvCandidates.length, polled: SCAN_RECORD_CAP, scanKey },
        '[CV status scan] In-flight backlog exceeds per-scan cap',
      )
    }
    for (const record of cvCandidates.slice(0, SCAN_RECORD_CAP)) {
      if (signal?.aborted) {
        this.logger.info(
          { scanKey },
          '[CV status scan] Stopped for shutdown; the next slot polls the rest',
        )
        return
      }
      try {
        await this.pollCvRecord(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id, scanKey },
          '[CV status scan] CV poll failed for record',
        )
      }
      await sleep(RETRIEVE_CV_SPACING_MS, signal)
    }

    // VERIFIED in-flight records still need their identity-profile state
    // tracked (case 3a/3b stall detection + finalize escalation), but never
    // another retrieve_cv read. Queried after the CV pass so a record that
    // just reached VERIFIED gets its first profile read in the same scan.
    const profileCandidates: RecordWithCampaignUser[] =
      await this.model.findMany({
        where: {
          campaign: scannableCampaign,
          internalTestingAt: null,
          peerlyIdentityId: { not: null },
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        },
        include: { campaign: { include: { user: true } } },
        orderBy: { updatedAt: Prisma.SortOrder.asc },
      })
    for (const record of profileCandidates.slice(0, SCAN_RECORD_CAP)) {
      if (signal?.aborted) {
        this.logger.info(
          { scanKey },
          '[CV status scan] Stopped for shutdown; the next slot polls the rest',
        )
        return
      }
      try {
        await this.pollProfileStatus(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id, scanKey },
          '[CV status scan] Profile poll failed for record',
        )
      }
      await sleep(PROFILE_READ_SPACING_MS, signal)
    }

    this.logger.info(
      {
        scanKey,
        cvPolled: Math.min(cvCandidates.length, SCAN_RECORD_CAP),
        profilesPolled: Math.min(profileCandidates.length, SCAN_RECORD_CAP),
      },
      '[CV status scan] Scan complete',
    )
  }

  private async pollCvRecord(record: RecordWithCampaignUser) {
    const { peerlyIdentityId } = record
    if (!peerlyIdentityId) {
      return
    }

    // Suppress per-identity Slack alerts — a Peerly outage during the scan
    // would otherwise page once per record; logs are the surface here.
    const details =
      await this.peerlyIdentityService.retrieveCampaignVerifyDetails(
        peerlyIdentityId,
        record.campaign,
        { suppressSlackAlert: true },
      )

    // The same observation drives PIN-delivery detection and late-rejection
    // handling — one retrieve_cv read serves all three consumers. Detection
    // runs before the status persist: persisting REJECTED/VERIFIED first
    // would drop the record out of the next scan's poll set even if the
    // detection write failed, silently stranding the internal status.
    // Detection itself is idempotent (atomic claims), so a re-run after a
    // failed persist is safe.
    await this.tcrComplianceService.applyCvDetection(
      record,
      record.campaign,
      details,
    )

    await this.persistObservedCvStatus(record, details.status)

    if (details.status === PeerlyCvVerificationStatus.VERIFIED) {
      await this.pollProfileStatus(record)
    }
  }

  // Persist "how long in this state" (ENG-10793). Unchanged values must not
  // touch the row at all — the nightly report's awaiting-PIN section keys off
  // updatedAt, so a no-op poll can't bump it.
  private async persistObservedCvStatus(
    record: TcrCompliance,
    cvStatus: PeerlyCvVerificationStatus | null,
  ) {
    if (cvStatus === record.peerlyCvStatus) {
      return
    }
    // A Peerly "no CV request" null after a real status was already observed
    // is not authoritative (the CV request may have been cleaned up on
    // Peerly's side) — erasing history here would flip the record into the
    // nightly report's case-1 "never reached CV" section.
    if (cvStatus === null && record.peerlyCvStatus !== null) {
      return
    }
    const data: Prisma.TcrComplianceUpdateInput = {
      peerlyCvStatus: cvStatus,
      peerlyCvStatusChangedAt: new Date(),
    }
    // Leaving IN_REVIEW is progress — a later re-stall is a new incident and
    // must re-escalate (ENG-10796).
    if (record.peerlyCvStatus === PeerlyCvVerificationStatus.IN_REVIEW) {
      data.cvInReviewEscalatedAt = null
    }
    // Leaving VERIFIED while waiting_to_finalize is also progress — the
    // profile poll is skipped when cvStatus !== VERIFIED, so the claim must
    // be cleared here or a future re-entry into VERIFIED+waiting_to_finalize
    // could never re-escalate.
    if (
      record.peerlyCvStatus === PeerlyCvVerificationStatus.VERIFIED &&
      record.peerlyProfileStatus === PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
    ) {
      data.finalizeStalledEscalatedAt = null
    }
    await this.model.update({ where: { id: record.id }, data })
  }

  private async pollProfileStatus(record: RecordWithCampaignUser) {
    const { peerlyIdentityId } = record
    if (!peerlyIdentityId) {
      return
    }
    // A 404 (NotFoundException) means the identity is gone on Peerly's side —
    // a definitive answer, not a failed read. Clear the stale profile status
    // rather than preserving it, or case 3a would flag the record forever.
    const profileResponse = await this.peerlyIdentityService
      .getIdentityProfile(peerlyIdentityId, record.campaign, {
        suppressSlackAlert: true,
      })
      .catch((err: Error) => {
        if (err instanceof NotFoundException) {
          return undefined
        }
        throw err
      })
    // A `null` response is an empty-body success or a swallowed API error
    // upstream (`data || null`) — a transient non-answer, so keep the stored
    // value (mirrors the null-CV guard above). The 404 path resolves to
    // `undefined` and IS definitive: the identity is gone, so fall through
    // and clear the stale status.
    if (profileResponse === null) {
      return
    }
    const profileStatus = profileResponse?.profile?.status ?? null
    if (profileStatus === record.peerlyProfileStatus) {
      return
    }
    const data: Prisma.TcrComplianceUpdateInput = {
      peerlyProfileStatus: profileStatus,
      peerlyProfileStatusChangedAt: new Date(),
    }
    // Same reset as the CV transition above — leaving waiting_to_finalize
    // re-arms the case-3b escalation for a future stall.
    if (
      record.peerlyProfileStatus === PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
    ) {
      data.finalizeStalledEscalatedAt = null
    }
    // Leaving `pending` is progress — finalized -> pending is a real
    // reopening (submitCvTokenToFinalizedBrand, reached via the re-enterable
    // retrieveCampaignVerifyToken / submit-cv-pin retry path), so a record
    // once alerted for case 3a can genuinely re-enter `pending` later. Clear
    // the claim here or that second real stall would never re-alert
    // (ENG-10966).
    if (record.peerlyProfileStatus === PEERLY_PROFILE_STATUS_PENDING) {
      data.profileStalledAlertedAt = null
    }
    await this.model.update({ where: { id: record.id }, data })
  }
}
