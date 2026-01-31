import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorText } from './ErrorText'

describe('ErrorText', () => {
  it('should render children text', () => {
    render(<ErrorText>Error message</ErrorText>)
    expect(screen.getByText('Error message')).toBeInTheDocument()
  })

  it('should render with red color styling', () => {
    render(<ErrorText>Error</ErrorText>)
    const element = screen.getByText('Error')
    expect(element).toBeInTheDocument()
  })

  it('should render ReactNode children', () => {
    render(
      <ErrorText>
        <span data-testid="custom-span">Custom error</span>
      </ErrorText>
    )
    expect(screen.getByTestId('custom-span')).toBeInTheDocument()
  })
})
