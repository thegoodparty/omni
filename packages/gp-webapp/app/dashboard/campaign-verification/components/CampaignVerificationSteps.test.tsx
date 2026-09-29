import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import CampaignVerificationSteps from './CampaignVerificationSteps'

interface MockElectionFilingFormProps {
  onSubmitted: () => void
  onBack?: () => void
  title?: string
  caption?: string
  contactTitle?: string
  contactCaption?: string
}

// The real filing form fetches the website, the campaign and the user; this
// suite is about the steps' own state machine and props, so it is stubbed
// down to its contract with the caller.
vi.mock(
  'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm',
  () => ({
    default: ({
      onSubmitted,
      onBack,
      title,
      caption,
      contactTitle,
      contactCaption,
    }: MockElectionFilingFormProps) => (
      <div>
        {title && <h2>{title}</h2>}
        {caption && <p>{caption}</p>}
        {contactTitle && <h2>{contactTitle}</h2>}
        {contactCaption && <p>{contactCaption}</p>}
        <button onClick={onBack}>Back</button>
        <button onClick={onSubmitted}>mock-submit</button>
      </div>
    ),
  }),
)

const SUBMITTED_TITLE = 'Submitted for verification'

const INTRO_TITLE = 'Verify your campaign to text voters'

// jsdom does not implement scrollTo; the steps reset scroll on every step
// change.
window.scrollTo = vi.fn()

describe('CampaignVerificationSteps', () => {
  let onExit: ReturnType<typeof vi.fn<() => void>>
  let onComplete: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    onExit = vi.fn<() => void>()
    onComplete = vi.fn<() => void>()
  })

  it('opens on the intro by default', () => {
    render(
      <CampaignVerificationSteps onExit={onExit} onComplete={onComplete} />,
    )

    expect(screen.getByText(INTRO_TITLE)).toBeInTheDocument()
  })

  it('opens on the step passed via initialStep', () => {
    render(
      <CampaignVerificationSteps
        initialStep="submitted"
        onExit={onExit}
        onComplete={onComplete}
      />,
    )

    expect(screen.getByText(SUBMITTED_TITLE)).toBeInTheDocument()
  })

  it('notifies the caller of the initial step and every change', async () => {
    const user = userEvent.setup()
    const onStepChange = vi.fn()
    render(
      <CampaignVerificationSteps
        onExit={onExit}
        onComplete={onComplete}
        onStepChange={onStepChange}
      />,
    )

    expect(onStepChange).toHaveBeenCalledWith('intro')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onStepChange).toHaveBeenCalledWith('form')

    await user.click(screen.getByText('mock-submit'))
    expect(onStepChange).toHaveBeenCalledWith('submitted')
  })

  it('calls onExit when Back is clicked on the intro', async () => {
    const user = userEvent.setup()
    render(
      <CampaignVerificationSteps onExit={onExit} onComplete={onComplete} />,
    )

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('returns to the intro when Back is clicked on the form, without calling onExit', async () => {
    const user = userEvent.setup()
    render(
      <CampaignVerificationSteps onExit={onExit} onComplete={onComplete} />,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByText(INTRO_TITLE)).toBeInTheDocument()
    expect(screen.queryByText('mock-submit')).not.toBeInTheDocument()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('passes the design copy for the filing-details and contact-information headings', async () => {
    const user = userEvent.setup()
    render(
      <CampaignVerificationSteps onExit={onExit} onComplete={onComplete} />,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByText('What are your campaign filing details?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'If these do not match the details you submitted on your campaign filing or registration, it will take much longer before you can send text messages.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What is your campaign filing contact information?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Enter the email, phone, or address exactly as it appears on your filing document. A PIN will be sent to one of these to verify your campaign.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the submitted confirmation and calls onComplete from its default-labeled primary action', async () => {
    const user = userEvent.setup()
    render(
      <CampaignVerificationSteps onExit={onExit} onComplete={onComplete} />,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByText('mock-submit'))

    expect(screen.getByText(SUBMITTED_TITLE)).toBeInTheDocument()
    expect(screen.getByText('A PIN is on its way')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('uses the caller-provided complete label', () => {
    render(
      <CampaignVerificationSteps
        initialStep="submitted"
        onExit={onExit}
        onComplete={onComplete}
        completeLabel="Back to my text"
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Back to my text' }),
    ).toBeInTheDocument()
  })
})
