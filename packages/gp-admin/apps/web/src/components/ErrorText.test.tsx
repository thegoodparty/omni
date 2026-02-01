import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorText } from './ErrorText'

describe('ErrorText', () => {
  it('displays the error message to users', () => {
    render(<ErrorText>Email is required</ErrorText>)
    expect(screen.getByText('Email is required')).toBeVisible()
  })

  it('displays complex content when passed as children', () => {
    render(
      <ErrorText>
        Please enter a valid <strong>email address</strong>
      </ErrorText>
    )
    expect(screen.getByText(/please enter a valid/i)).toBeVisible()
    expect(screen.getByText('email address')).toBeVisible()
  })
})
