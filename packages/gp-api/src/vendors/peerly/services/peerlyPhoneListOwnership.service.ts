import { ForbiddenException, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '../../../prisma/util/prisma.util'

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
  // Best-effort: a bookkeeping failure must not break the user's upload — the
  // outreach gate's trust-on-first-use covers a missing record.
  async recordUpload(campaignId: number, token: string): Promise<void> {
    try {
      await this.model.upsert({
        where: { token },
        create: { campaignId, token },
        update: {},
      })
    } catch (err) {
      this.logger.error(
        { err, campaignId },
        'Failed to record P2P phone list ownership at upload',
      )
    }
  }

  // Bind the resolved Peerly list_id to the owning campaign's upload row once the
  // list goes active, so the outreach gate can resolve list_id -> campaign.
  // Best-effort and idempotent (only fills a still-null listId).
  async linkListId(token: string, listId: number): Promise<void> {
    try {
      await this.model.updateMany({
        // updateMany bypasses Prisma's @updatedAt auto-stamp, so set it
        // explicitly — otherwise updated_at would misreport when the list_id
        // was resolved.
        where: { token, listId: null },
        data: { listId, updatedAt: new Date() },
      })
    } catch (err) {
      this.logger.error(
        { err, listId },
        'Failed to link Peerly list_id to phone list ownership row',
      )
    }
  }

  // Gate for P2P outreach creation: verify the caller's campaign owns the phone
  // list it is assigning to a job. Throws when a *different* campaign owns the
  // list (the IDOR). For a list with no ownership record yet — uploaded before
  // this table existed and not captured by the migration backfill — claim it for
  // the caller (trust-on-first-use) and log, so the legacy residual converges to
  // fully tracked without ever blocking a user.
  async assertCampaignOwnsList(
    campaignId: number,
    listId: number,
  ): Promise<void> {
    const existing = await this.model.findUnique({ where: { listId } })

    if (existing) {
      if (existing.campaignId !== campaignId) {
        throw new ForbiddenException(
          'Phone list does not belong to this campaign',
        )
      }
      return
    }

    this.logger.warn(
      { campaignId, listId },
      'P2P phone list had no ownership record; claiming for caller (trust-on-first-use)',
    )
    try {
      await this.model.create({ data: { campaignId, listId } })
      return
    } catch (err) {
      // create can fail two ways: (1) a concurrent request claimed the same
      // listId first (unique-constraint race), or (2) a transient write error.
      // Re-read to honor whoever actually owns the row.
      const owner = await this.model.findUnique({ where: { listId } })
      if (owner) {
        if (owner.campaignId !== campaignId) {
          throw new ForbiddenException(
            'Phone list does not belong to this campaign',
          )
        }
        return
      }
      // No owner persisted (case 2): the list is still unclaimed, so there is no
      // other tenant to protect. Allow the caller through rather than block a
      // legitimate outreach — the next call re-attempts the claim. This is the
      // deliberate trust-on-first-use posture, not an ownership bypass: a list a
      // *different* campaign owns is always rejected above.
      this.logger.warn(
        { err, campaignId, listId },
        'P2P phone list ownership claim did not persist; allowing (no competing owner)',
      )
    }
  }
}
