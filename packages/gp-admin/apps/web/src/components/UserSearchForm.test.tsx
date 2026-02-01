import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserSearchForm } from './UserSearchForm'

// Create stable mock objects
const mockPush = vi.fn()
const mockSearchParamsValues: Record<string, string | null> = {}

const mockSearchParams = {
  get: vi.fn((key: string) => mockSearchParamsValues[key] ?? null),
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
    mockSearchParams.get.mockClear()
    // Reset search params
    Object.keys(mockSearchParamsValues).forEach(
      (key) => delete mockSearchParamsValues[key]
    )
  })

  describe('rendering', () => {
    it('renders search form with email tab by default', () => {
      render(<UserSearchForm />)

      expect(screen.getByText('Search by')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Email' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Name' })).toBeInTheDocument()
      expect(
        screen.getByPlaceholderText('Enter email address...')
      ).toBeInTheDocument()
    })

    it('renders with name tab when URL has name params', () => {
      mockSearchParamsValues['first_name'] = 'John'
      mockSearchParamsValues['last_name'] = 'Doe'

      render(<UserSearchForm />)

      expect(
        screen.getByPlaceholderText('Enter first name...')
      ).toBeInTheDocument()
      expect(
        screen.getByPlaceholderText('Enter last name...')
      ).toBeInTheDocument()
    })

    it('pre-fills email from URL params', () => {
      mockSearchParamsValues['email'] = 'test@example.com'

      render(<UserSearchForm />)

      expect(screen.getByPlaceholderText('Enter email address...')).toHaveValue(
        'test@example.com'
      )
    })
  })

  describe('tab switching', () => {
    it('switches to name tab and shows name fields', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))

      expect(
        screen.getByPlaceholderText('Enter first name...')
      ).toBeInTheDocument()
      expect(
        screen.getByPlaceholderText('Enter last name...')
      ).toBeInTheDocument()
      expect(
        screen.queryByPlaceholderText('Enter email address...')
      ).not.toBeInTheDocument()
    })

    it('switches back to email tab and clears name fields', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      // Switch to name tab
      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      // Switch back to email tab
      await user.click(screen.getByRole('radio', { name: 'Email' }))

      expect(
        screen.getByPlaceholderText('Enter email address...')
      ).toBeInTheDocument()
    })

    it('clears email when switching to name tab', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      // Type email
      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test@example.com'
      )

      // Switch to name tab
      await user.click(screen.getByRole('radio', { name: 'Name' }))

      // Switch back to email - email should be cleared
      await user.click(screen.getByRole('radio', { name: 'Email' }))

      expect(screen.getByPlaceholderText('Enter email address...')).toHaveValue(
        ''
      )
    })
  })

  describe('email validation', () => {
    it('shows error for invalid email', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'invalid'
      )

      await waitFor(() => {
        expect(
          screen.getByText('Please enter a valid email address')
        ).toBeInTheDocument()
      })
    })

    it('enables submit button with valid email', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'valid@example.com'
      )

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /search/i })
        ).not.toBeDisabled()
      })
    })
  })

  describe('name validation', () => {
    it('shows error when name is too short', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(screen.getByPlaceholderText('Enter first name...'), 'A')

      await waitFor(() => {
        expect(
          screen.getByText('Must be at least 2 characters')
        ).toBeInTheDocument()
      })
    })

    it('requires both first and last name', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      // Only first name filled - button should be disabled
      expect(screen.getByRole('button', { name: /search/i })).toBeDisabled()
    })

    it('enables submit when both names are valid', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )
      await user.type(screen.getByPlaceholderText('Enter last name...'), 'Doe')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /search/i })
        ).not.toBeDisabled()
      })
    })
  })

  describe('form submission', () => {
    it('submits email search and navigates', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test@example.com'
      )

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /search/i })
        ).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /search/i }))

      expect(mockPush).toHaveBeenCalledWith(
        '/dashboard/users?email=test%40example.com'
      )
    })

    it('submits name search and navigates', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )
      await user.type(screen.getByPlaceholderText('Enter last name...'), 'Doe')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /search/i })
        ).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /search/i }))

      expect(mockPush).toHaveBeenCalledWith(
        '/dashboard/users?first_name=John&last_name=Doe'
      )
    })
  })

  describe('clear functionality', () => {
    it('shows clear button when email has value', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      expect(
        screen.queryByRole('button', { name: /clear/i })
      ).not.toBeInTheDocument()

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test'
      )

      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    })

    it('shows clear button when name fields have values', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    })

    it('clears form and navigates to base path', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test@example.com'
      )

      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(mockPush).toHaveBeenCalledWith('/dashboard/users')
      expect(screen.getByPlaceholderText('Enter email address...')).toHaveValue(
        ''
      )
    })
  })
})
