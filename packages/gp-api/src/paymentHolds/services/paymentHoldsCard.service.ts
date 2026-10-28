import { Injectable, NotFoundException } from '@nestjs/common'
import {
  PaymentHoldCardIntentResponse,
  PaymentHoldCardResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { SaveCardAndPlanResult } from '../paymentHolds.types'
import { PaymentHoldsService } from './paymentHolds.service'

export type HoldCardScope =
  | { campaignId: number }
  | { organizationSlug: string }

const toResponse = (result: SaveCardAndPlanResult): PaymentHoldCardResponse =>
  result.outcome === 'held'
    ? { outcome: 'held', captureBefore: result.captureBefore.toISOString() }
    : result

@Injectable()
export class PaymentHoldsCardService extends createPrismaBase(MODELS.Outreach) {
  constructor(private readonly holds: PaymentHoldsService) {
    super()
  }

  createIntent(userId: number): Promise<PaymentHoldCardIntentResponse> {
    return this.holds.createCardSetupIntent({ userId })
  }

  // A send outside the caller's scope answers 404, the same as a missing one.
  async updateCard(
    scope: HoldCardScope,
    outreachId: number,
    userId: number,
    paymentMethodId: string,
  ): Promise<PaymentHoldCardResponse> {
    const owned = await this.model.findFirst({
      where: {
        id: outreachId,
        ...('campaignId' in scope
          ? { campaignId: scope.campaignId }
          : { organizationSlug: scope.organizationSlug, campaignId: null }),
      },
      select: { id: true },
    })
    if (!owned) {
      throw new NotFoundException('Send not found')
    }
    return toResponse(
      await this.holds.updateCard({ outreachId, userId, paymentMethodId }),
    )
  }
}
