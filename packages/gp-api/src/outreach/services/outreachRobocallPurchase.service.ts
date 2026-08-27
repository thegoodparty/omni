import { BadRequestException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import z from 'zod'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { OutreachRobocallService } from './outreachRobocall.service'

// The checkout metadata for a robocall purchase. PurchaseService merges the
// server-validated campaignId into the client's { outreachId }; both arrive as
// strings off Stripe metadata on the webhook path, hence coerce. Nothing else
// is trusted — the audience, count, and amount are all re-derived from the
// draft the outreachId points at (scoped to campaignId).
const RobocallPurchaseMetadataSchema = z.object({
  outreachId: z.coerce.number().int().positive(),
  campaignId: z.coerce.number().int().positive(),
})

@Injectable()
export class OutreachRobocallPurchaseService implements PurchaseHandler<unknown> {
  constructor(
    private readonly robocallService: OutreachRobocallService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachRobocallPurchaseService.name)
  }

  async validatePurchase(rawMetadata: unknown): Promise<void> {
    const result = RobocallPurchaseMetadataSchema.safeParse(rawMetadata)
    if (!result.success) {
      throw new BadRequestException(result.error.message)
    }
    await this.robocallService.assertPurchasable(
      result.data.outreachId,
      result.data.campaignId,
    )
  }

  async calculateAmount(rawMetadata: unknown): Promise<number> {
    const { outreachId, campaignId } =
      RobocallPurchaseMetadataSchema.parse(rawMetadata)
    return this.robocallService.deriveDraftAmount(outreachId, campaignId)
  }

  async executePostPurchase(
    paymentIntentId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    const result = RobocallPurchaseMetadataSchema.safeParse(rawMetadata)
    // A non-robocall session shape here is not this handler's to finalize.
    if (!result.success) {
      return
    }
    const { outreachId, campaignId } = result.data

    // Throwing propagates to completeCheckoutSession, which only stamps its
    // idempotency marker after the handler succeeds — so a failed finalize
    // makes Stripe retry rather than marking the purchase processed.
    await this.robocallService.finalizeRobocallPurchase(outreachId, campaignId)
    this.logger.info(
      `Robocall ${outreachId} finalized after payment ${paymentIntentId}`,
    )
  }
}
