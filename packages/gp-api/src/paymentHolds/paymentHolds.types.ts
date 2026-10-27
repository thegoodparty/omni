import { OutreachHoldState } from '@/generated/prisma'

export type SaveCardAndPlanInput = {
  outreachId: number
  userId: number
  paymentMethodId: string
  estimateCents: number
}

export type SaveCardAndPlanResult =
  | { outcome: 'held'; captureBefore: Date }
  | { outcome: 'scheduled' }
  | { outcome: 'declined'; declineCode: string | null }

export type HoldView = {
  state: OutreachHoldState
  authorizedCents: number | null
  captureBefore: Date | null
}

export type CardSetupIntent = {
  clientSecret: string
}

// Every call is idempotent per outreachId, so a retried request or a
// redelivered message can call it again safely.
export interface PaymentHoldsApi {
  createCardSetupIntent(input: { userId: number }): Promise<CardSetupIntent>
  saveCardAndPlan(input: SaveCardAndPlanInput): Promise<SaveCardAndPlanResult>
  getHold(outreachId: number): Promise<HoldView | null>
  reschedule(input: { outreachId: number }): Promise<void>
  settle(input: { outreachId: number }): Promise<void>
  release(input: { outreachId: number }): Promise<void>
  updateCard(input: {
    outreachId: number
    userId: number
    paymentMethodId: string
  }): Promise<SaveCardAndPlanResult>
}

// The only call the hold system makes into a channel. It runs inside settle,
// under the capturing claim: stop the send, wait until nothing is in flight,
// then report what is owed. `ready: false` means the channel is still
// draining and settle retries later.
export interface SettlementAdapter {
  stopAndReport(
    outreachId: number,
  ): Promise<{ ready: true; amountCents: number } | { ready: false }>
}
