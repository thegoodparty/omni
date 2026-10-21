import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { VendorBalanceCard } from './VendorBalanceCard'

const renderCard = (props: Parameters<typeof VendorBalanceCard>[0]) =>
  render(
    <Theme>
      <VendorBalanceCard {...props} />
    </Theme>
  )

const account = (balance: number, creditLimit = 1400) => ({
  balance,
  creditLimit,
  readAt: new Date('2026-10-01T17:00:00Z'),
})

describe('VendorBalanceCard', () => {
  it('shows the balance and credit limit as dollars', () => {
    renderCard({ account: account(2512.4) })

    expect(screen.getByText('$2,512.40')).toBeInTheDocument()
    expect(screen.getByText('Credit limit $1,400.00')).toBeInTheDocument()
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
    expect(screen.queryByText('On credit')).not.toBeInTheDocument()
  })

  it('flags a low balance', () => {
    renderCard({ account: account(412) })

    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('flags a negative balance as running on credit', () => {
    renderCard({ account: account(-88.396) })

    expect(screen.getByText('-$88.40')).toBeInTheDocument()
    expect(screen.getByText('On credit')).toBeInTheDocument()
  })

  it('renders an unavailable state when the vendor read failed', () => {
    renderCard({ account: null })

    expect(screen.getByText('Peerly balance')).toBeInTheDocument()
    expect(screen.getByText('Unavailable right now')).toBeInTheDocument()
  })
})
