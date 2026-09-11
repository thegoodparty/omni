import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import SignUpForm from './SignUpForm'

const create = vi.fn()
const authenticateWithRedirect = vi.fn()
const prepareEmailAddressVerification = vi.fn()
const setActive = vi.fn()

vi.mock('@clerk/nextjs/legacy', () => ({
  useSignUp: () => ({
    isLoaded: true,
    setActive,
    signUp: {
      create,
      authenticateWithRedirect,
      prepareEmailAddressVerification,
      attemptEmailAddressVerification: vi.fn(),
    },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: { SignUp: { ClickLogin: 'signup_click_login' } },
  trackEvent: vi.fn(),
}))

const fillRequiredFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText('First Name'), 'Ada')
  await user.type(screen.getByPlaceholderText('Last Name'), 'Lovelace')
  await user.type(screen.getByPlaceholderText('Email'), 'ada@goodparty.org')
  await user.type(
    screen.getByPlaceholderText('Create Password'),
    'hunter2hunter2',
  )
  await user.click(screen.getByTestId('signup-terms'))
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({ status: 'missing_requirements' })
  authenticateWithRedirect.mockReset().mockResolvedValue(undefined)
  prepareEmailAddressVerification.mockReset().mockResolvedValue(undefined)
  setActive.mockReset()
})

describe('SignUpForm phone capture', () => {
  it('formats the number as it is typed but submits bare digits', async () => {
    const user = userEvent.setup()
    render(<SignUpForm />)

    const phone = screen.getByPlaceholderText('Phone')
    await user.type(phone, '5551234567')
    expect(phone).toHaveValue('(555) 123-4567')

    await fillRequiredFields(user)
    await user.click(screen.getByTestId('signup-submit'))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ unsafeMetadata: { phone: '5551234567' } }),
    )
  })

  it('ignores a digit past the cap instead of eating the last one', async () => {
    const user = userEvent.setup()
    render(<SignUpForm />)

    const phone = screen.getByPlaceholderText('Phone')
    // 11 digits fills the field (leading country code).
    await user.type(phone, '15551234567')
    expect(phone).toHaveValue('1 (555) 123-4567')

    await user.type(phone, '8')
    expect(phone).toHaveValue('1 (555) 123-4567')
  })

  it('keeps the submit button disabled until the phone is complete', async () => {
    const user = userEvent.setup()
    render(<SignUpForm />)

    await fillRequiredFields(user)
    expect(screen.getByTestId('signup-submit')).toBeDisabled()

    await user.type(screen.getByPlaceholderText('Phone'), '5551234567')
    expect(screen.getByTestId('signup-submit')).toBeEnabled()
  })

  it('leaves Google one click and sends it to the phone step', async () => {
    const user = userEvent.setup()
    render(<SignUpForm />)

    await user.click(screen.getByTestId('signup-google'))

    expect(authenticateWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: '/sign-up/sso-callback' }),
    )
    expect(authenticateWithRedirect.mock.calls[0]?.[0]).not.toHaveProperty(
      'unsafeMetadata',
    )
  })
})
