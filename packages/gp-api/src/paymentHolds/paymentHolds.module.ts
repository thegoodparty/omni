import { Module } from '@nestjs/common'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { OutreachOrphanedHoldService } from './services/outreachOrphanedHold.service'
import { PaymentHoldsService } from './services/paymentHolds.service'
import { PaymentHoldsSweepService } from './services/paymentHoldsSweep.service'

@Module({
  imports: [StripeModule],
  providers: [
    PaymentHoldsService,
    PaymentHoldsSweepService,
    OutreachOrphanedHoldService,
  ],
  exports: [PaymentHoldsService],
})
export class PaymentHoldsModule {}
