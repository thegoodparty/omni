import { Injectable, NotImplementedException } from '@nestjs/common'
import {
  CardSetupIntent,
  HoldView,
  PaymentHoldsApi,
  SaveCardAndPlanResult,
} from '../paymentHolds.types'

// Refuses every call until the hold workstream lands. It must never report
// success: the email endpoints are not behind a server-side flag, so a stub
// that pretended to hold a card would let a send go out unpaid. Channels
// test against it with vi.spyOn.
@Injectable()
export class PaymentHoldsService implements PaymentHoldsApi {
  async createCardSetupIntent(): Promise<CardSetupIntent> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async saveCardAndPlan(): Promise<SaveCardAndPlanResult> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async getHold(): Promise<HoldView | null> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async reschedule(): Promise<void> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async settle(): Promise<void> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async release(): Promise<void> {
    throw new NotImplementedException('Payment holds are not built yet')
  }

  async updateCard(): Promise<SaveCardAndPlanResult> {
    throw new NotImplementedException('Payment holds are not built yet')
  }
}
