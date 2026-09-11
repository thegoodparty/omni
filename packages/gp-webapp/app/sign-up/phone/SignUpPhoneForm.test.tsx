import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import SignUpPhoneForm from './SignUpPhoneForm'

const update = vi.fn()
const mockUseUser = vi.fn()

vi.mock('@clerk/nextjs', () => ({
  useUser: () => mockUseUser(),
}))

let replaceSpy: ReturnType<typeof vi.fn>

const signedInAs = (unsafeMetadata: Record<string, unknown> = {}) => ({
  isLoaded: true,
  isSignedIn: true,
  user: { unsafeMetadata, update },
})

beforeEach(() => {
  update.mockReset().mockResolvedValue(undefined)
  mockUseUser.mockReset().mockReturnValue(signedInAs())
  replaceSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: replaceSpy },
  })
  api.mock('PUT /v1/users/me', { status: 200, data: {} as never })
})

describe('SignUpPhoneForm', () => {
  it('saves the number to gp-api and Clerk, then continues', async () => {
    const user = userEvent.setup()
    let sentBody: unknown
    api.mock('PUT /v1/users/me', ({ body }) => {
      sentBody = body
      return { status: 200, data: {} as never }
    })
    render(<SignUpPhoneForm />)

    await user.type(screen.getByPlaceholderText('Phone'), '5551234567')
    await user.click(screen.getByTestId('signup-phone-submit'))

    await waitFor(() => expect(sentBody).toEqual({ phone: '5551234567' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        unsafeMetadata: { phone: '5551234567' },
      }),
    )
    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        '/post-auth-redirect?source=signup',
      ),
    )
  })

  it('keeps the user here when the save fails', async () => {
    const user = userEvent.setup()
    api.mock('PUT /v1/users/me', { status: 500, data: {} })
    render(<SignUpPhoneForm />)

    await user.type(screen.getByPlaceholderText('Phone'), '5551234567')
    await user.click(screen.getByTestId('signup-phone-submit'))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'We could not save your number. Please try again.',
      ),
    )
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('continues anyway when only the Clerk copy fails', async () => {
    const user = userEvent.setup()
    update.mockRejectedValue(new Error('clerk down'))
    render(<SignUpPhoneForm />)

    await user.type(screen.getByPlaceholderText('Phone'), '5551234567')
    await user.click(screen.getByTestId('signup-phone-submit'))

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        '/post-auth-redirect?source=signup',
      ),
    )
  })

  it('does not ask again when the user already has a number', async () => {
    mockUseUser.mockReturnValue(signedInAs({ phone: '5559876543' }))
    render(<SignUpPhoneForm />)

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        '/post-auth-redirect?source=signup',
      ),
    )
  })

  it('still asks when the stored metadata phone is blank or junk', async () => {
    // unsafeMetadata is user-writable via Clerk's client SDK, so a blank or
    // nonsense value must not count as "already has a number".
    for (const value of ['', '   ', 'nope']) {
      replaceSpy.mockClear()
      mockUseUser.mockReturnValue(signedInAs({ phone: value }))
      const { unmount } = render(<SignUpPhoneForm />)
      await waitFor(() =>
        expect(screen.getByTestId('signup-phone-form')).toBeInTheDocument(),
      )
      expect(replaceSpy).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('sends a signed-out visitor back to sign up', async () => {
    mockUseUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
      user: null,
    })
    render(<SignUpPhoneForm />)

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/sign-up'))
  })

  it('keeps Continue disabled until the number is complete', async () => {
    const user = userEvent.setup()
    render(<SignUpPhoneForm />)

    expect(screen.getByTestId('signup-phone-submit')).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Phone'), '555123')
    expect(screen.getByTestId('signup-phone-submit')).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Phone'), '4567')
    expect(screen.getByTestId('signup-phone-submit')).toBeEnabled()
  })
})
