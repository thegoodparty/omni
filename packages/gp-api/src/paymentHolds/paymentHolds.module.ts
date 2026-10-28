import { Module } from '@nestjs/common'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { OutreachOrphanedHoldService } from './services/outreachOrphanedHold.service'
import { PaymentHoldsService } from './services/paymentHolds.service'

@Module({
  imports: [StripeModule],
  providers: [PaymentHoldsService, OutreachOrphanedHoldService],
  exports: [PaymentHoldsService],
})
export class PaymentHoldsModule {}
