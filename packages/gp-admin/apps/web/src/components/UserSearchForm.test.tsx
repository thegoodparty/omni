import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { UserSearchForm } from './UserSearchForm'

// Create stable mock objects outside the factory
const mockPush = vi.fn()
const mockSearchParams = {
  get: vi.fn().mockReturnValue(null),
}

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams,
}))

describe('UserSearchForm', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockSearchParams.get.mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders search form with tab controls', () => {
    render(<UserSearchForm />)

    expect(screen.getByText('Search by')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Name' })).toBeInTheDocument()
  })

  it('renders email input field', () => {
    render(<UserSearchForm />)

    expect(
      screen.getByPlaceholderText('Enter email address...')
    ).toBeInTheDocument()
  })

  it('renders search button that is initially disabled', () => {
    render(<UserSearchForm />)

    const searchButton = screen.getByRole('button', { name: /search/i })
    expect(searchButton).toBeInTheDocument()
    expect(searchButton).toBeDisabled()
  })

  it('does not show clear button when form is empty', () => {
    render(<UserSearchForm />)

    expect(
      screen.queryByRole('button', { name: /clear/i })
    ).not.toBeInTheDocument()
  })
})
