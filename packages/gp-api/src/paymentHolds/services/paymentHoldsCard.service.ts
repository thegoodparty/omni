import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  PaymentHoldCardIntentResponse,
  PaymentHoldCardResponse,
} from '@goodparty_org/contracts'
import { OutreachStatus } from '@/generated/prisma'
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
  // A draft's card goes through the channel's confirm, which also freezes the
  // send and its price; placing a hold here would skip both.
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
      select: { status: true },
    })
    if (!owned) {
      throw new NotFoundException('Send not found')
    }
    if (owned.status === OutreachStatus.draft) {
      throw new ConflictException('Confirm this send to pay for it')
    }
    return toResponse(
      await this.holds.updateCard({ outreachId, userId, paymentMethodId }),
    )
  }
}
