import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserSearchForm } from './UserSearchForm'

// Create stable mock objects
const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockSearchParamsValues: Record<string, string | null> = {}

const mockSearchParams = {
  get: vi.fn((key: string) => mockSearchParamsValues[key] ?? null),
}

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}))

describe('UserSearchForm', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockReplace.mockClear()
    mockSearchParams.get.mockClear()
    // Reset search params
    Object.keys(mockSearchParamsValues).forEach(
      (key) => delete mockSearchParamsValues[key]
    )
  })

  afterEach(() => {
    vi.useRealTimers()
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

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      await user.click(screen.getByRole('radio', { name: 'Email' }))

      expect(
        screen.getByPlaceholderText('Enter email address...')
      ).toBeInTheDocument()
    })

    it('clears email when switching to name tab', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test@example.com'
      )

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.click(screen.getByRole('radio', { name: 'Email' }))

      expect(screen.getByPlaceholderText('Enter email address...')).toHaveValue(
        ''
      )
    })

    it('does not navigate with stale values when switching back to a previously visited tab', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/dashboard/users?first_name=John'
        )
      })
      mockReplace.mockClear()

      await user.click(screen.getByRole('radio', { name: 'Email' }))
      await user.click(screen.getByRole('radio', { name: 'Name' }))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/users')
      })
      expect(mockReplace).not.toHaveBeenCalledWith(
        expect.stringContaining('first_name=John')
      )
    })
  })

  describe('email auto-search', () => {
    it('auto-searches via router.replace after debounce delay', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'jo'
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/users?email=jo')
      })
    })

    it('searches with a single character', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'j'
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/users?email=j')
      })
    })

    it('searches with the final value after rapid input', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.type(
        screen.getByPlaceholderText('Enter email address...'),
        'test@example.com'
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenLastCalledWith(
          '/dashboard/users?email=test%40example.com'
        )
      })
    })

    it('navigates to base path when email is cleared', async () => {
      const user = userEvent.setup()
      mockSearchParamsValues['email'] = 'test@example.com'
      render(<UserSearchForm />)

      await user.clear(screen.getByPlaceholderText('Enter email address...'))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/users')
      })
    })
  })

  describe('name auto-search', () => {
    it('searches with just first name', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/dashboard/users?first_name=John'
        )
      })
    })

    it('searches with just last name', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(screen.getByPlaceholderText('Enter last name...'), 'Doe')

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/dashboard/users?last_name=Doe'
        )
      })
    })

    it('searches with both first and last name', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )
      await user.type(screen.getByPlaceholderText('Enter last name...'), 'Doe')

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(
          '/dashboard/users?first_name=John&last_name=Doe'
        )
      })
    })

    it('searches with the final value after rapid input', async () => {
      const user = userEvent.setup()
      render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(
        screen.getByPlaceholderText('Enter first name...'),
        'John'
      )

      await waitFor(() => {
        expect(mockReplace).toHaveBeenLastCalledWith(
          '/dashboard/users?first_name=John'
        )
      })
    })

    it('navigates to base path when both name fields are cleared', async () => {
      const user = userEvent.setup()
      mockSearchParamsValues['first_name'] = 'John'
      render(<UserSearchForm />)

      await user.clear(screen.getByPlaceholderText('Enter first name...'))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/users')
      })
    })
  })

  describe('form submission', () => {
    it('navigates to base path when submitted values trim to empty', async () => {
      const user = userEvent.setup()
      const { container } = render(<UserSearchForm />)

      await user.click(screen.getByRole('radio', { name: 'Name' }))
      await user.type(screen.getByPlaceholderText('Enter first name...'), '  ')
      await user.type(screen.getByPlaceholderText('Enter last name...'), '  ')

      // Submit form directly — bypasses auto-search, exercises onSubmit handler
      fireEvent.submit(container.querySelector('form')!)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard/users')
      })
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
