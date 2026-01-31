import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingSpinner } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('should render without children', () => {
    const { container } = render(<LoadingSpinner />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render with children text', () => {
    render(<LoadingSpinner>Loading...</LoadingSpinner>)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('should render with custom size prop', () => {
    const { container } = render(<LoadingSpinner size="2" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render with custom padding prop', () => {
    const { container } = render(<LoadingSpinner p="4" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render with all props', () => {
    render(
      <LoadingSpinner size="1" p="2">
        Please wait
      </LoadingSpinner>
    )
    expect(screen.getByText('Please wait')).toBeInTheDocument()
  })
})
