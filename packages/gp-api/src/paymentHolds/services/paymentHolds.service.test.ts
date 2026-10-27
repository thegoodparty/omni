import { NotImplementedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { PaymentHoldsService } from './paymentHolds.service'

// Until the hold workstream lands, nothing may read as a successful hold: a
// send would otherwise go out unpaid.
describe('PaymentHoldsService (not built yet)', () => {
  const service = new PaymentHoldsService()

  it.each([
    () => service.createCardSetupIntent(),
    () => service.saveCardAndPlan(),
    () => service.getHold(),
    () => service.reschedule(),
    () => service.settle(),
    () => service.release(),
    () => service.updateCard(),
  ])('refuses every call', async (call) => {
    await expect(call()).rejects.toBeInstanceOf(NotImplementedException)
  })
})
