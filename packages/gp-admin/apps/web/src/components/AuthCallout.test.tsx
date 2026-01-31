import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthCallout } from './AuthCallout'

describe('AuthCallout', () => {
  it('displays the message to users', () => {
    render(<AuthCallout message="Please sign in to continue." />)
    expect(screen.getByText('Please sign in to continue.')).toBeVisible()
  })

  it('renders with default red color', () => {
    const { container } = render(<AuthCallout message="Error occurred" />)
    const callout = container.querySelector('[data-accent-color="red"]')
    expect(callout).toBeInTheDocument()
  })

  it('renders with amber color when specified', () => {
    const { container } = render(
      <AuthCallout message="Warning message" color="amber" />
    )
    const callout = container.querySelector('[data-accent-color="amber"]')
    expect(callout).toBeInTheDocument()
  })

  it('centers the callout when centered prop is true', () => {
    const { container } = render(
      <AuthCallout message="Centered message" centered />
    )
    const flexContainer = container.querySelector('.rt-Flex')
    expect(flexContainer).toBeInTheDocument()
  })

  it('does not wrap in flex container when not centered', () => {
    const { container } = render(<AuthCallout message="Not centered" />)
    const flexContainer = container.querySelector('.rt-Flex')
    expect(flexContainer).not.toBeInTheDocument()
  })
})
