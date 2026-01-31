import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingSpinner } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders the spinner component', () => {
    const { container } = render(<LoadingSpinner />)
    expect(container.querySelector('.rt-Spinner')).toBeInTheDocument()
  })

  it('displays loading message alongside the spinner when provided', () => {
    render(<LoadingSpinner>Loading your data...</LoadingSpinner>)
    expect(screen.getByText('Loading your data...')).toBeVisible()
  })
})
