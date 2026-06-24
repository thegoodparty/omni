import { ForbiddenException, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '../../../prisma/util/prisma.util'

const NOT_OWNED_MESSAGE = 'Phone list does not belong to this campaign'

// Owns the peerly_phone_list table: the mapping from an uploaded Peerly phone
// list to the campaign that created it. Peerly is one shared account across all
// campaigns and list ids are sequential, so this mapping is the only ownership
// signal available — see peerlyPhoneList.prisma.
@Injectable()
export class PeerlyPhoneListOwnershipService extends createPrismaBase(
  MODELS.PeerlyPhoneList,
) {
  // _prisma and logger are property-injected by the createPrismaBase base class.

  // Record ownership when a campaign uploads a phone list. The Peerly list_id is
  // not known yet (resolved later at status time), so only the token is stored.
  // This write is REQUIRED, not best-effort: the gates fail closed, so a list
  // with no ownership row is permanently unusable. Let a failure propagate (the
  // upload endpoint surfaces it so the caller can retry) rather than silently
  // leaving the list in an unusable state.
  async recordUpload(campaignId: number, token: string): Promise<void> {
    await this.model.upsert({
      where: { token },
      create: { campaignId, token },
      update: {},
    })
  }

  // Bind the resolved Peerly list_id to the owning campaign's upload row once the
  // list goes active, so the outreach gate can resolve list_id -> campaign.
  // Best-effort and idempotent (only fills a still-null listId).
  async linkListId(token: string, listId: number): Promise<void> {
    try {
      const { count } = await this.model.updateMany({
        // updateMany bypasses Prisma's @updatedAt auto-stamp, so set it
        // explicitly — otherwise updated_at would misreport when the list_id
        // was resolved.
        where: { token, listId: null },
        data: { listId, updatedAt: new Date() },
      })
      if (count === 0) {
        // No upload row to stamp. recordUpload propagates its failures, so a
        // successful upload always has a row — count 0 means the token predates
        // this table or its row was removed. The outreach gate fails closed, so
        // surface this for visibility.
        this.logger.warn(
          { token, listId },
          'No phone list ownership row to link list_id to (upload record missing)',
        )
      }
    } catch (err) {
      this.logger.error(
        { err, listId },
        'Failed to link Peerly list_id to phone list ownership row',
      )
    }
  }

  // Gate for P2P outreach creation: verify the caller's campaign owns the phone
  // list it is assigning to a job. Fails closed — a listId with no ownership
  // record is rejected, not claimed. Trust-on-first-use is unsafe here because
  // Peerly list ids are sequential and account-global: a freshly-uploaded list
  // has no listId row until the uploader's first status-check runs linkListId,
  // so claiming-on-miss would let another campaign race in and steal it. Lists
  // already in use are bound by the migration backfill; the legitimate uploader
  // can only learn its own listId by polling status, which stamps the row first.
  async assertCampaignOwnsList(
    campaignId: number,
    listId: number,
  ): Promise<void> {
    const existing = await this.model.findUnique({ where: { listId } })

    if (!existing) {
      this.logger.warn(
        { campaignId, listId },
        'P2P phone list has no ownership record; denying access',
      )
      throw new ForbiddenException(NOT_OWNED_MESSAGE)
    }

    if (existing.campaignId !== campaignId) {
      throw new ForbiddenException(NOT_OWNED_MESSAGE)
    }
  }
}
