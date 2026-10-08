import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma, PhoneListBuildStatus } from '@/generated/prisma'

@Injectable()
export class PeerlyPhoneListCaptureService extends createPrismaBase(
  MODELS.PeerlyPhoneList,
) {
  // The build is moving off the HTTP request into a background job
  // (Voter Outreach 2.0): a row needs to exist — and be pollable — before a
  // Peerly token is ever minted. Created `queued` (the schema default),
  // with no token; `recordUpload` advances this same row rather than
  // inserting a second one. `requestSnapshot` is the validated POST body —
  // persisted so the async build handler can redo filter resolution without
  // the HTTP request around to ask again (it is unused on the synchronous
  // path, but captured unconditionally so a later switch-flip doesn't need
  // a backfill).
  createQueuedBuild(params: {
    organizationSlug: string
    campaignId: number
    voterFileFilterId: number | null
    requestSnapshot: Prisma.InputJsonValue
  }) {
    const { organizationSlug, campaignId, voterFileFilterId, requestSnapshot } =
      params
    return this.model.create({
      data: {
        organizationSlug,
        campaignId,
        voterFileFilterId,
        requestSnapshot,
      },
    })
  }

  // Single-owner CAS: elects exactly one handler to build a given row.
  // count 0 means a concurrent delivery already owns it, or it has already
  // advanced past `queued` (processing/ready/failed) — the caller treats
  // either as an idempotent no-op. Bumps buildAttempts so the stale-building
  // reaper can tell a row that keeps failing from one on its first try.
  async claimForBuild(buildId: string): Promise<boolean> {
    const claim = await this.model.updateMany({
      where: { id: buildId, buildStatus: PhoneListBuildStatus.queued },
      data: {
        buildStatus: PhoneListBuildStatus.building,
        buildAttempts: { increment: 1 },
      },
    })
    return claim.count > 0
  }

  // Stamped the moment Peerly accepts the upload, BEFORE the (slower)
  // recipients write — so a crash between the two leaves a `building` row
  // that still carries proof Peerly already has this exact list. The queued-
  // build handler checks this first and skips a second upload rather than
  // ever sending the same list to Peerly twice.
  async stampBuildToken(buildId: string, token: string): Promise<void> {
    await this.model.update({ where: { id: buildId }, data: { token } })
  }

  // Advances the pre-created `queued` row to `processing` with the Peerly
  // token and the two exclusion counts, and writes the recipient rows —
  // together, so a list Peerly never received can never gain recipient rows
  // (callers only invoke this after the Peerly upload has already
  // succeeded). Updates, not inserts: the row from `createQueuedBuild`
  // already exists by `buildId`.
  async recordUpload(params: {
    buildId: string
    token: string
    recipients: { personId: string; phone: string }[]
    excludedOptedOutCount: number
    excludedDuplicatePhoneCount: number
  }): Promise<void> {
    const {
      buildId,
      token,
      recipients,
      excludedOptedOutCount,
      excludedDuplicatePhoneCount,
    } = params

    await this.client.$transaction(
      async (tx) => {
        await tx.peerlyPhoneList.update({
          where: { id: buildId },
          data: {
            token,
            excludedOptedOutCount,
            excludedDuplicatePhoneCount,
            buildStatus: PhoneListBuildStatus.processing,
          },
        })
        await tx.peerlyPhoneListRecipient.createMany({
          data: recipients.map(({ personId, phone }) => ({
            peerlyPhoneListId: buildId,
            personId,
            phone,
          })),
        })
      },
      // Recipients are capped at 100k rows and a large saved list's
      // createMany overruns Prisma's default 5s interactive-transaction
      // timeout (prod P2028s, 2026-09), failing the upload AFTER Peerly
      // already accepted the list — so the candidate's retry uploads a
      // duplicate. Sized for the cap, not the common case.
      { timeout: 60_000 },
    )
  }

  // The synchronous build/upload threw (empty audience, Peerly error) —
  // park the row rather than leaving it orphaned at `queued`/`building`
  // forever. `buildError` is a short message, not a stack trace: this is a
  // status a future poller reads, not a log.
  async markBuildFailed(buildId: string, buildError: string): Promise<void> {
    await this.model.update({
      where: { id: buildId },
      data: { buildStatus: PhoneListBuildStatus.failed, buildError },
    })
  }

  // Stamps the numeric Peerly list id and advances the row to `ready` the
  // first time the status endpoint (either route — token or buildId) sees
  // the list ACTIVE. Guarded on peerlyListId IS NULL so a repeat poll after
  // the first success is a no-op rather than a re-write.
  async stampPeerlyListId(token: string, peerlyListId: number): Promise<void> {
    await this.model.updateMany({
      where: { token, peerlyListId: null },
      data: { peerlyListId, buildStatus: PhoneListBuildStatus.ready },
    })
  }

  // Candidates for the server-side build finisher: a row Peerly has already
  // accepted (`processing`, token minted) that no browser poll has advanced
  // to `ready`, and that has sat untouched past `staleCutoff`. peerlyListId is
  // always null for a `processing` row (stampPeerlyListId sets the id and
  // `ready` together), but it is filtered explicitly so the finisher never
  // re-reads an already-stamped list. token is always set on a `processing`
  // row (recordUpload writes token + status together); the `not: null` filter
  // lets the caller treat it as present. The `updatedAt` floor targets
  // genuinely-stranded rows and keeps the finisher off rows a live browser is
  // still polling — a still-loading list under active poll keeps a fresh
  // updatedAt (isLeadsLoadedStable writes each unstable read). Oldest first
  // and capped at `take` so one sweep issues a bounded number of Peerly reads.
  findUnfinishedProcessing(params: {
    staleCutoff: Date
    take: number
  }): Promise<{ id: string; token: string | null }[]> {
    return this.model.findMany({
      where: {
        buildStatus: PhoneListBuildStatus.processing,
        peerlyListId: null,
        token: { not: null },
        updatedAt: { lt: params.staleCutoff },
      },
      select: { id: true, token: true },
      orderBy: { updatedAt: 'asc' },
      take: params.take,
    })
  }

  // Recipients live on a sibling model to the one this service extends, so
  // they're read via `client` rather than the inherited `findMany`. Ordered
  // by id so skip/take pagination is stable across calls (unordered
  // findMany offers no such guarantee).
  findRecipientsPage(
    peerlyPhoneListId: string,
    params: { skip: number; take: number },
  ): Promise<{ personId: string }[]> {
    return this.client.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId },
      select: { personId: true },
      orderBy: { id: 'asc' },
      skip: params.skip,
      take: params.take,
    })
  }

  // The inbound sweep matches vendor-reported phones against the whole
  // captured list at once; lists are bounded by the upload cap, so one
  // unpaged read is fine.
  findRecipientsWithPhones(
    peerlyPhoneListId: string,
  ): Promise<{ personId: string; phone: string }[]> {
    return this.client.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId },
      select: { personId: true, phone: true },
    })
  }

  // Billing fallback when Peerly's own leads_loaded can't be fetched: the
  // captured rows are the recipients the list actually uploaded with.
  countRecipients(peerlyPhoneListId: string): Promise<number> {
    return this.client.peerlyPhoneListRecipient.count({
      where: { peerlyPhoneListId },
    })
  }

  // Peerly flips a list to ACTIVE as soon as it accepts the upload, but a
  // large list keeps loading leads after that — `leads_loaded` climbs for a
  // while before settling. Stamping `ready` on the first ACTIVE read
  // overstates how many leads actually landed for a still-loading list, so a
  // list is only "ready" once `leads_loaded` is either already fully loaded
  // (equal to what Peerly says we supplied) or has read the SAME value twice
  // in a row across separate polls. A small list satisfies the first test on
  // its very first read — it stabilizes immediately, exactly like before
  // this guard — so only a still-climbing large list ever waits.
  //
  // Called from either status route (token or buildId) — both resolve to the
  // same row, so comparing/persisting by buildId lets the two routes share
  // one observation history instead of racing separate ones.
  async isLeadsLoadedStable(params: {
    buildId: string
    leadsLoaded: number
    leadsSupplied: number
  }): Promise<boolean> {
    const { buildId, leadsLoaded, leadsSupplied } = params

    // Observability only, never blocking: leads_supplied SHOULD equal what
    // we told Peerly we were sending. A mismatch doesn't change the
    // stability verdict — it's logged in case it ever points at a real
    // discrepancy (e.g. a filter re-run between upload and this poll).
    const recipientCount = await this.countRecipients(buildId)
    if (leadsSupplied !== recipientCount) {
      this.logger.warn(
        { buildId, leadsSupplied, recipientCount },
        "Peerly's leads_supplied does not match our uploaded recipient count",
      )
    }

    if (leadsLoaded === leadsSupplied) return true

    const row = await this.model.findUnique({
      where: { id: buildId },
      select: { lastSeenLeadsLoaded: true },
    })
    if (row?.lastSeenLeadsLoaded === leadsLoaded) return true

    // Not stable yet — record this read so the NEXT poll (either route) can
    // compare against it. A no-op write failure here just means the next
    // poll compares against an older value, which only delays stabilizing a
    // large list; it never wrongly stamps ready.
    await this.model.updateMany({
      where: { id: buildId },
      data: { lastSeenLeadsLoaded: leadsLoaded },
    })
    return false
  }

  // Candidates for the stale-building reaper: a row claimed (queued ->
  // building) by some handler invocation that never finished — crashed,
  // OOM-killed, or lost its SQS message — older than `staleCutoff`.
  findStaleBuilding(staleCutoff: Date): Promise<{ id: string }[]> {
    return this.model.findMany({
      where: {
        buildStatus: PhoneListBuildStatus.building,
        updatedAt: { lt: staleCutoff },
      },
      select: { id: true },
    })
  }

  // Reaper's permanent-failure arm: a row that has already exhausted its
  // retry budget. The same staleness CAS as the retry arm (buildStatus +
  // updatedAt), so a healthy in-flight run (fresh updatedAt) or a row
  // another reaper replica already moved can't be double-handled.
  async failStaleBuilding(
    buildId: string,
    staleCutoff: Date,
    buildError: string,
  ): Promise<boolean> {
    const result = await this.model.updateMany({
      where: {
        id: buildId,
        buildStatus: PhoneListBuildStatus.building,
        updatedAt: { lt: staleCutoff },
      },
      data: { buildStatus: PhoneListBuildStatus.failed, buildError },
    })
    return result.count > 0
  }

  // Reaper's retry arm: releases a stranded `building` claim back to
  // `queued` so it becomes claimable again (by claimForBuild, via a fresh
  // enqueue). Same CAS reasoning as failStaleBuilding.
  async reclaimStaleBuilding(
    buildId: string,
    staleCutoff: Date,
  ): Promise<boolean> {
    const result = await this.model.updateMany({
      where: {
        id: buildId,
        buildStatus: PhoneListBuildStatus.building,
        updatedAt: { lt: staleCutoff },
      },
      data: { buildStatus: PhoneListBuildStatus.queued },
    })
    return result.count > 0
  }

  // Undoes reclaimStaleBuilding when the re-enqueue itself fails, so the row
  // doesn't strand at `queued` with no message ever coming to claim it — the
  // reaper only looks at `building` rows, so a `queued` row with a dead
  // enqueue would otherwise sit forever.
  async revertReclaimedBuilding(buildId: string): Promise<void> {
    await this.model.updateMany({
      where: { id: buildId, buildStatus: PhoneListBuildStatus.queued },
      data: { buildStatus: PhoneListBuildStatus.building },
    })
  }
}
