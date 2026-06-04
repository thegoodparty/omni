import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfoCard } from './InfoCard'

describe('InfoCard', () => {
  it('renders title and children', () => {
    render(
      <InfoCard title="Test Title">
        <p>Test content</p>
      </InfoCard>
    )

    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('renders action when provided', () => {
    render(
      <InfoCard title="Title" action={<button>Action</button>}>
        <p>Content</p>
      </InfoCard>
    )

    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('renders without action when not provided', () => {
    render(
      <InfoCard title="Title">
        <p>Content</p>
      </InfoCard>
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
