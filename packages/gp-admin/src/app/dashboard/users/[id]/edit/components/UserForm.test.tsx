import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/lib/test-utils'
import { UserForm } from './UserForm'
import { UserRole, type User } from '@goodparty_org/sdk'
import type { UserFormData } from '../schema'

vi.mock('next-navigation-guard', () => ({
  useNavigationGuard: vi.fn(),
}))

// A realistic legacy row: no phone, no zip. The write schema rejects '' for
// both, so the form must not submit fields the admin didn't touch.
const mockUser: User = {
  id: 42,
  firstName: 'Khaled',
  lastName: 'Omar',
  name: 'Khaled Omar',
  email: 'khaled@example.com',
  phone: null,
  zip: null,
  avatar: null,
  hasPassword: true,
  roles: [UserRole.candidate],
  metaData: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
}

describe('UserForm', () => {
  let onSave: ReturnType<
    typeof vi.fn<(data: UserFormData) => void | Promise<void>>
  >
  let onCancel: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onSave = vi.fn<(data: UserFormData) => void | Promise<void>>()
    onCancel = vi.fn<() => void>()
  })

  function renderForm(overrides?: Partial<User>) {
    const user = overrides ? { ...mockUser, ...overrides } : mockUser
    return renderWithProviders(
      <UserForm initialData={user} onSave={onSave} onCancel={onCancel} />
    )
  }

  async function save() {
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
  }

  it('submits only the fields the admin changed', async () => {
    renderForm()

    await userEvent.type(screen.getByPlaceholderText('Phone'), '(415) 555-2671')
    await save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ phone: '(415) 555-2671' })
  })

  it('normalizes pasted phones: trims whitespace and unicode dashes', async () => {
    renderForm()

    // U+2011 non-breaking hyphens plus a trailing space, as pasted from
    // Contacts/mail clients
    await userEvent.type(screen.getByPlaceholderText('Phone'), '415‑555‑2671 ')
    await save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ phone: '415-555-2671' })
  })

  it('submits only the zip when only the zip changed', async () => {
    renderForm()

    await userEvent.type(screen.getByPlaceholderText('ZIP'), '90210')
    await save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ zip: '90210' })
  })

  it('submits the full roles array when a role is toggled', async () => {
    renderForm()

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0]
    expect(Object.keys(payload)).toEqual(['roles'])
    expect(payload.roles).toEqual(
      expect.arrayContaining([UserRole.admin, UserRole.candidate])
    )
    expect(payload.roles).toHaveLength(2)
  })

  it('submits only the changed metaData keys', async () => {
    renderForm()

    await userEvent.click(screen.getByRole('switch'))
    await save()

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({
      metaData: { textNotifications: true },
    })
  })

  it('ignores a second click while a save is in flight', async () => {
    let resolveSave: () => void = () => {}
    onSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    renderForm()

    await userEvent.type(screen.getByPlaceholderText('Phone'), '4155552671')
    const saveButton = screen.getByRole('button', { name: /save changes/i })
    await userEvent.click(saveButton)
    await userEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(saveButton).toBeDisabled())
    resolveSave()
  })
})
