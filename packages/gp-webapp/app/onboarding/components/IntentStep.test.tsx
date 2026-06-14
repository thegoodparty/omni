import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntentStep } from './IntentStep'

describe('IntentStep', () => {
  it('renders both cards with the office name', () => {
    render(
      <IntentStep
        officeName="City Council Member"
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    expect(
      screen.getByText("I'm running for the same office"),
    ).toBeInTheDocument()
    expect(screen.getByText("I'm running for a new office")).toBeInTheDocument()
    expect(screen.getByText(/City Council Member/)).toBeInTheDocument()
  })

  it('records the chosen intent', () => {
    const onChange = vi.fn()
    render(
      <IntentStep
        officeName="City Council Member"
        value={undefined}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText("I'm running for the same office"))
    expect(onChange).toHaveBeenCalledWith('same-office')
  })

  it('reflects the pre-selected value', () => {
    render(
      <IntentStep
        officeName="City Council Member"
        value="same-office"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/same office/i)).toBeChecked()
  })
})
