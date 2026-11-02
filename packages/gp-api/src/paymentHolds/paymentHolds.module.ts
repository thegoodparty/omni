import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { PaymentHoldsController } from './paymentHolds.controller'
import { PaymentHoldsServeController } from './paymentHoldsServe.controller'
import { OutreachOrphanedHoldService } from './services/outreachOrphanedHold.service'
import { PaymentHoldEventsService } from './services/paymentHoldEvents.service'
import { PaymentHoldsService } from './services/paymentHolds.service'
import { PaymentHoldsCardService } from './services/paymentHoldsCard.service'
import { PaymentHoldsSweepService } from './services/paymentHoldsSweep.service'

@Module({
  imports: [ElectedOfficeModule, StripeModule],
  controllers: [PaymentHoldsController, PaymentHoldsServeController],
  providers: [
    PaymentHoldsService,
    PaymentHoldEventsService,
    PaymentHoldsCardService,
    PaymentHoldsSweepService,
    OutreachOrphanedHoldService,
  ],
  exports: [PaymentHoldsService],
})
export class PaymentHoldsModule {}
