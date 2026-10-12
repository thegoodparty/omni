import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

// The free-texts (5,000) offer restore for a Win p2p SMS hold that is unwound
// before it bills — a void (the hold released, nothing captured) or a refund
// (a captured charge returned). Centralized so EVERY release terminal (cancel,
// deny, and the capture-time void) hands the offer back the same way.
//
// Two guards keep an unwind from ever granting free texts a send did not earn:
//   1. the PER-SEND stamp (OutreachP2pSms.freeTextsApplied) — only a send that
//      actually redeemed the offer gives it back; a full-price send restores
//      nothing. This is the server-authoritative signal the capture reads, never
//      the client-writable billableTextCount or a count proxy.
//   2. the campaign's REDEEMED marker (hasFreeTextsOffer false +
//      freeTextsOfferRedeemedAt set) — the campaign update is guarded on it, so
//      a retry or a deny/cancel race can't double-grant (a second restore finds
//      the offer already available and no-ops) and a campaign that never redeemed
//      is never handed an offer it did not have.
@Injectable()
export class OutreachP2pSmsFreeTextsService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  // Idempotent. Returns true when it restored (or had already restored this
  // send's offer), false when this send never consumed the offer so there is
  // nothing to hand back.
  async restore(outreachId: number): Promise<boolean> {
    const sms = await this.model.findUnique({
      where: { outreachId },
      select: {
        freeTextsApplied: true,
        outreach: { select: { campaignId: true } },
      },
    })
    // A send that did not redeem the offer (or whose restore already cleared the
    // stamp) owes nothing back.
    if (!sms?.freeTextsApplied) return false
    const campaignId = sms.outreach?.campaignId
    if (campaignId == null) return false

    // Flip the campaign marker and clear the per-send stamp ATOMICALLY, so there
    // is no window where the campaign offer is back but this send's stamp is still
    // set — which a second send's redemption plus a re-invoked restore could ride
    // to double-grant. The campaign flip is guarded on the REDEEMED state so a
    // second caller finds the offer already available and no-ops; clearing the
    // stamp in the same transaction makes a re-invoke a no-op at the stamp check
    // above.
    await this.client.$transaction(async (tx) => {
      await tx.campaign.updateMany({
        where: {
          id: campaignId,
          hasFreeTextsOffer: false,
          freeTextsOfferRedeemedAt: { not: null },
        },
        data: { hasFreeTextsOffer: true, freeTextsOfferRedeemedAt: null },
      })
      await tx.outreachP2pSms.updateMany({
        where: { outreachId, freeTextsApplied: true },
        data: { freeTextsApplied: false },
      })
    })
    return true
  }
}
