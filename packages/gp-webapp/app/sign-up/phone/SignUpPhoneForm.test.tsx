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
  api.mock('GET /v1/users/me', { status: 200, data: { phone: null } as never })
})

// The step asks gp-api whether a number is already on record before it
// renders anything, so every test that touches the form has to let that
// settle first.
const renderForm = async () => {
  const utils = render(<SignUpPhoneForm />)
  await waitFor(() =>
    expect(screen.getByTestId('signup-phone-form')).toBeInTheDocument(),
  )
  return utils
}

describe('SignUpPhoneForm', () => {
  it('saves the number to gp-api and Clerk, then continues', async () => {
    const user = userEvent.setup()
    let sentBody: unknown
    api.mock('PUT /v1/users/me', ({ body }) => {
      sentBody = body
      return { status: 200, data: {} as never }
    })
    await renderForm()

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
    await renderForm()

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
    await renderForm()

    await user.type(screen.getByPlaceholderText('Phone'), '5551234567')
    await user.click(screen.getByTestId('signup-phone-submit'))

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        '/post-auth-redirect?source=signup',
      ),
    )
  })

  it('does not ask an account that already has a number on record', async () => {
    api.mock('GET /v1/users/me', {
      status: 200,
      data: { phone: '5559876543' } as never,
    })
    render(<SignUpPhoneForm />)

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        '/post-auth-redirect?source=signup',
      ),
    )
    expect(screen.queryByTestId('signup-phone-form')).not.toBeInTheDocument()
  })

  it('ignores Clerk metadata and trusts the user row', async () => {
    // unsafeMetadata is user-writable through Clerk's client SDK, so it must
    // not be able to wave the step through on its own.
    mockUseUser.mockReturnValue(signedInAs({ phone: '5551112222' }))
    api.mock('GET /v1/users/me', {
      status: 200,
      data: { phone: null } as never,
    })
    render(<SignUpPhoneForm />)

    await waitFor(() =>
      expect(screen.getByTestId('signup-phone-form')).toBeInTheDocument(),
    )
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('still asks when the number on record is blank or junk', async () => {
    for (const value of [null, '', '   ', 'nope']) {
      replaceSpy.mockClear()
      api.mock('GET /v1/users/me', {
        status: 200,
        data: { phone: value } as never,
      })
      const { unmount } = render(<SignUpPhoneForm />)
      await waitFor(() =>
        expect(screen.getByTestId('signup-phone-form')).toBeInTheDocument(),
      )
      expect(replaceSpy).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('shows the form when the lookup fails rather than stranding the user', async () => {
    api.mock('GET /v1/users/me', { status: 500, data: {} })
    render(<SignUpPhoneForm />)

    await waitFor(() =>
      expect(screen.getByTestId('signup-phone-form')).toBeInTheDocument(),
    )
    expect(replaceSpy).not.toHaveBeenCalled()
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
    await renderForm()

    expect(screen.getByTestId('signup-phone-submit')).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Phone'), '555123')
    expect(screen.getByTestId('signup-phone-submit')).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Phone'), '4567')
    expect(screen.getByTestId('signup-phone-submit')).toBeEnabled()
  })
})
