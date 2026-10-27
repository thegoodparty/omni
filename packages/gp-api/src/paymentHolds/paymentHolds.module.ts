import { Module } from '@nestjs/common'
import { PaymentHoldsService } from './services/paymentHolds.service'

@Module({
  providers: [PaymentHoldsService],
  exports: [PaymentHoldsService],
})
export class PaymentHoldsModule {}
