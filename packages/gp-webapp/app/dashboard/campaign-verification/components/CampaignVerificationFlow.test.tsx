import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import CampaignVerificationFlow from './CampaignVerificationFlow'

let mockSearchParams = new URLSearchParams()

// The global setup mocks next/navigation with useRouter only; this
// component also needs useSearchParams, so override the module for this
// file.
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => mockSearchParams,
}))

// The real filing form fetches the website, the campaign and the user; this
// suite is about the flow's own state machine, so both screens are stubbed
// down to their contract with the flow.
vi.mock(
  'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm',
  () => ({
    default: ({ onSubmitted }: { onSubmitted: () => void }) => (
      <button onClick={onSubmitted}>mock-submit</button>
    ),
  }),
)

vi.mock(
  'app/dashboard/profile/texting-compliance/verification-submitted/components/VerificationSubmittedContent',
  () => ({
    default: () => <div>mock-submitted</div>,
  }),
)

const INTRO_TITLE = 'Campaign verification to send text messages'

// jsdom does not implement scrollTo; the flow resets scroll on every step
// change.
window.scrollTo = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockSearchParams = new URLSearchParams()
})

describe('CampaignVerificationFlow', () => {
  it('opens on the intro with what the candidate needs', () => {
    render(<CampaignVerificationFlow />)

    expect(screen.getByText(INTRO_TITLE)).toBeInTheDocument()
    expect(screen.getByText('Your filing details')).toBeInTheDocument()
    expect(screen.getByText('Contact details')).toBeInTheDocument()
    expect(screen.getByText('About 1 to 2 weeks')).toBeInTheDocument()
  })

  it('shows the filing form after Continue', async () => {
    const user = userEvent.setup()
    render(<CampaignVerificationFlow />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('mock-submit')).toBeInTheDocument()
    expect(screen.queryByText(INTRO_TITLE)).not.toBeInTheDocument()
  })

  it('shows the submitted confirmation once the form reports a submit', async () => {
    const user = userEvent.setup()
    render(<CampaignVerificationFlow />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByText('mock-submit'))

    expect(screen.getByText('mock-submitted')).toBeInTheDocument()
    // The stepper only counts the two steps the candidate acts on, so it
    // disappears on the confirmation.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('returns to the intro when Back is clicked on the form', async () => {
    const user = userEvent.setup()
    render(<CampaignVerificationFlow />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByText(INTRO_TITLE)).toBeInTheDocument()
    expect(screen.queryByText('mock-submit')).not.toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('leaves for the dashboard when Back is clicked on the intro', async () => {
    const user = userEvent.setup()
    render(<CampaignVerificationFlow />)

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('shows the submitted confirmation on mount when the URL already carries step=submitted', () => {
    mockSearchParams = new URLSearchParams('step=submitted')

    render(<CampaignVerificationFlow />)

    expect(screen.getByText('mock-submitted')).toBeInTheDocument()
  })

  it('replaces the URL with step=submitted once the form reports a submit', async () => {
    const user = userEvent.setup()
    render(<CampaignVerificationFlow />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByText('mock-submit'))

    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/campaign-verification?step=submitted',
    )
  })
})
