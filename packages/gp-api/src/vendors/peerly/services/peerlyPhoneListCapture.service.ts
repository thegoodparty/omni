import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { PhoneListBuildStatus } from '@/generated/prisma'

@Injectable()
export class PeerlyPhoneListCaptureService extends createPrismaBase(
  MODELS.PeerlyPhoneList,
) {
  // The build is moving off the HTTP request into a background job
  // (Voter Outreach 2.0): a row needs to exist — and be pollable — before a
  // Peerly token is ever minted. Created `queued` (the schema default),
  // with no token; `recordUpload` advances this same row rather than
  // inserting a second one.
  createQueuedBuild(params: {
    organizationSlug: string
    campaignId: number
    voterFileFilterId: number | null
  }) {
    const { organizationSlug, campaignId, voterFileFilterId } = params
    return this.model.create({
      data: { organizationSlug, campaignId, voterFileFilterId },
    })
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
}
