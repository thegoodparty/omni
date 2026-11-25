import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import type { PlanReceipt } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { PlanReceiptCard } from './PlanReceiptCard'

const receipt = (overrides: Partial<PlanReceipt>): PlanReceipt => ({
  amountCents: 29900,
  paidAt: '2026-11-17T12:00:00.000Z',
  cardBrand: 'visa',
  cardLast4: '4242',
  paymentMethod: 'card',
  receiptUrl: null,
  planEndsAt: null,
  ...overrides,
})

const open = (value: PlanReceipt) => {
  render(<PlanReceiptCard receipt={value} plan="pro" />)
  fireEvent.click(screen.getByRole('button', { name: /Your receipt/ }))
}

describe('PlanReceiptCard payment row', () => {
  it('names Afterpay, which has no card', () => {
    open(
      receipt({ paymentMethod: 'afterpay', cardBrand: null, cardLast4: null }),
    )

    expect(screen.getByText('Paid with')).toBeInTheDocument()
    expect(screen.getByText('Afterpay')).toBeInTheDocument()
    expect(screen.queryByText('Card')).not.toBeInTheDocument()
  })

  it('names the wallet on top of the card', () => {
    open(receipt({ paymentMethod: 'apple_pay' }))

    expect(screen.getByText('Visa •••• 4242 via Apple Pay')).toBeInTheDocument()
  })

  it('shows a plain card as before', () => {
    open(receipt({}))

    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument()
  })
})
