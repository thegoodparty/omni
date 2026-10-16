import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { User } from 'helpers/types'
import { PersonalInformationCard } from './PersonalInformationCard'

const { mockOpenUserProfile, mockSetUser, mockUseAppUser } = vi.hoisted(() => ({
  mockOpenUserProfile: vi.fn(),
  mockSetUser: vi.fn(),
  mockUseAppUser: vi.fn(),
}))

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    user: {
      firstName: 'ClerkFirst',
      lastName: 'ClerkLast',
      primaryEmailAddress: { emailAddress: 'jane@example.com' },
      primaryPhoneNumber: null,
      externalAccounts: [],
    },
  }),
  useClerk: () => ({ openUserProfile: mockOpenUserProfile }),
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseAppUser(),
}))

const baseUser: User = {
  id: 1,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Jane',
  lastName: 'Doe',
  hasPassword: true,
  email: 'jane@example.com',
  roles: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAppUser.mockReturnValue([baseUser, mockSetUser, false])
})

describe('PersonalInformationCard', () => {
  it('shows the gp-api name over the Clerk name', () => {
    render(<PersonalInformationCard user={baseUser} />)
    expect(screen.getByText('Jane')).toBeInTheDocument()
    expect(screen.getByText('Doe')).toBeInTheDocument()
    expect(screen.queryByText('ClerkFirst')).not.toBeInTheDocument()
  })

  it('saves trimmed names to gp-api and updates the shared user', async () => {
    const user = userEvent.setup()
    const updatedUser = { ...baseUser, firstName: 'Janet', lastName: 'Smith' }
    let sentBody: unknown
    api.mock('PUT /v1/users/me', ({ body }) => {
      sentBody = body
      return { status: 200, data: updatedUser }
    })

    render(<PersonalInformationCard user={baseUser} />)
    await user.click(screen.getByRole('button', { name: 'Edit details' }))

    const firstNameInput = screen.getByLabelText('First name')
    const lastNameInput = screen.getByLabelText('Last name')
    expect(firstNameInput).toHaveValue('Jane')
    await user.clear(firstNameInput)
    await user.type(firstNameInput, '  Janet ')
    await user.clear(lastNameInput)
    await user.type(lastNameInput, ' Smith  ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() =>
      expect(sentBody).toEqual({ firstName: 'Janet', lastName: 'Smith' }),
    )
    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(updatedUser))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('shows an inline error and keeps the dialog open when the save fails', async () => {
    const user = userEvent.setup()
    api.mock('PUT /v1/users/me', { status: 500, data: {} as never })

    render(<PersonalInformationCard user={baseUser} />)
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(
      await screen.findByText('We could not save your name. Try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockSetUser).not.toHaveBeenCalled()
  })

  it('rejects names shorter than 2 characters without calling the API', async () => {
    const user = userEvent.setup()
    let called = false
    api.mock('PUT /v1/users/me', () => {
      called = true
      return { status: 200, data: baseUser }
    })

    render(<PersonalInformationCard user={baseUser} />)
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    const firstNameInput = screen.getByLabelText('First name')
    await user.clear(firstNameInput)
    await user.type(firstNameInput, ' J ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(
      await screen.findByText(
        'First and last name each need at least 2 characters.',
      ),
    ).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('opens the Clerk profile with the name section hidden', async () => {
    const user = userEvent.setup()
    render(<PersonalInformationCard user={baseUser} />)
    await user.click(screen.getByRole('button', { name: 'Manage sign-in' }))
    expect(mockOpenUserProfile).toHaveBeenCalledWith({
      appearance: {
        elements: { profileSection__profile: { display: 'none' } },
      },
    })
  })
})
