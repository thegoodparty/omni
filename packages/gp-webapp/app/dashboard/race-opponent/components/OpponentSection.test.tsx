import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OpponentSection from './OpponentSection'

describe('OpponentSection', () => {
  it('renders its body open by default', () => {
    render(
      <OpponentSection title="What you need to know">
        <p>Body content</p>
      </OpponentSection>,
    )
    expect(screen.getByText('Body content')).toBeVisible()
  })

  it('collapses and re-expands its body on header click', async () => {
    const user = userEvent.setup()
    render(
      <OpponentSection title="What you need to know">
        <p>Body content</p>
      </OpponentSection>,
    )
    const trigger = screen.getByRole('button', {
      name: /What you need to know/,
    })

    await user.click(trigger)
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByText('Body content')).toBeVisible()
  })

  it('starts collapsed when defaultOpen is false', () => {
    render(
      <OpponentSection title="Finance summary" defaultOpen={false}>
        <p>Body content</p>
      </OpponentSection>,
    )
    expect(screen.queryByText('Body content')).not.toBeInTheDocument()
  })
})
