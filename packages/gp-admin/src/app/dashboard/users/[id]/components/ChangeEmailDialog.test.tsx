import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@/shared/gpApi'
import { UserProvider } from '../context/UserContext'
import { ChangeEmailDialog } from './ChangeEmailDialog'

const NEW_EMAIL = 'new@example.com'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

const mockChange = vi.fn()
vi.mock('../changeEmail.actions', () => ({
  changeUserEmail: (...args: unknown[]) => mockChange(...args),
}))

const user: User = {
  id: 348,
  firstName: 'Kat',
  lastName: 'Camara',
  email: 'old@example.com',
  hasPassword: false,
  createdAt: new Date('2026-11-10'),
  avatar: null,
  zip: null,
  phone: null,
}

const changed = (crm: Record<string, string | boolean>) => ({
  data: { user: { ...user, email: NEW_EMAIL }, crm },
  error: null,
})

const submit = async () => {
  const ue = userEvent.setup()
  render(
    <UserProvider user={user}>
      <ChangeEmailDialog />
    </UserProvider>
  )
  await ue.click(screen.getByRole('button', { name: 'Change' }))
  await ue.type(screen.getByLabelText('New email'), ` ${NEW_EMAIL} `)
  await ue.click(screen.getByRole('button', { name: 'Change email' }))
  return ue
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangeEmailDialog', () => {
  it('changes the email and refreshes the page', async () => {
    mockChange.mockResolvedValue(changed({ status: 'updated', contactId: '1' }))

    await submit()

    expect(mockChange).toHaveBeenCalledWith(user.id, NEW_EMAIL)
    expect(mockShowToast).toHaveBeenCalledWith('Email changed')
    expect(mockRefresh).toHaveBeenCalled()
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument()
  })

  it('shows why the change was refused', async () => {
    mockChange.mockResolvedValue({
      data: null,
      error: 'Email belongs to user 99',
    })

    await submit()

    expect(
      await screen.findByText('Email belongs to user 99')
    ).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('names both HubSpot contacts when another one holds the email', async () => {
    mockChange.mockResolvedValue(
      changed({
        status: 'conflict',
        contactId: '111',
        conflictingContactId: '222',
      })
    )

    const ue = await submit()

    expect(await screen.findByText('Email changed.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '222' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/record\/0-1\/222$/)
    )
    expect(screen.getByRole('link', { name: '111' })).toBeInTheDocument()
    expect(mockShowToast).not.toHaveBeenCalled()

    await ue.click(screen.getByRole('button', { name: 'Done' }))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('asks staff to add the old email when HubSpot did not keep it', async () => {
    mockChange.mockResolvedValue(
      changed({
        status: 'updated',
        contactId: '111',
        previousEmailKept: false,
      })
    )

    await submit()

    expect(
      await screen.findByText(/HubSpot didn't keep old@example.com/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '111' })).toBeInTheDocument()
    expect(mockShowToast).not.toHaveBeenCalled()
  })
})
