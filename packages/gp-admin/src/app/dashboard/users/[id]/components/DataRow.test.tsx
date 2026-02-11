import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataRow } from './DataRow'

describe('DataRow', () => {
  it('renders label and children', () => {
    render(<DataRow label="Email">test@example.com</DataRow>)

    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('renders dash when children is null', () => {
    render(<DataRow label="Phone">{null}</DataRow>)

    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders dash when children is undefined', () => {
    render(<DataRow label="ZIP">{undefined}</DataRow>)

    expect(screen.getByText('ZIP')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders complex children', () => {
    render(
      <DataRow label="Status">
        <span data-testid="badge">Active</span>
      </DataRow>
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('Active')
  })
})
