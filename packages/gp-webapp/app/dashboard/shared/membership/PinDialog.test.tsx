import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { CV_PIN_GATE } from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'
import type { TcrCompliance } from 'helpers/types'
import { PinDialog } from './PinDialog'

const mockUseCvPinGate = vi.fn()
vi.mock(
  'app/dashboard/profile/texting-compliance/shared/useCvPinGate',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('app/dashboard/profile/texting-compliance/shared/useCvPinGate')
    >()),
    useCvPinGate: () => mockUseCvPinGate(),
  }),
)

const mockSubmit = vi.fn()
const mockUseSubmitCvPin = vi.fn()
vi.mock(
  'app/dashboard/profile/texting-compliance/shared/useSubmitCvPin',
  () => ({
    useSubmitCvPin: (...args: unknown[]) => mockUseSubmitCvPin(...args),
  }),
)

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const getPinInput = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: 'PIN' }) as HTMLInputElement

// Radix's own dialog-dismiss icon button also has the accessible name
// "Close" (its sr-only label), so a plain getByRole('button', {name:
// 'Close'}) matches both it and our footer button. The icon button carries
// an svg; ours doesn't.
const getFooterCloseButton = (): HTMLElement =>
  screen
    .getAllByRole('button', { name: 'Close' })
    .find((button) => !button.querySelector('svg')) as HTMLElement

beforeEach(() => {
  mockUseCvPinGate.mockReset()
  mockSubmit.mockReset()
  mockUseSubmitCvPin.mockReset()
  mockUseSubmitCvPin.mockReturnValue({
    submit: mockSubmit,
    submitting: false,
    error: null,
  })
  vi.mocked(trackEvent).mockClear()
})

// input-otp schedules setTimeout(…, 0/10/50ms) on mount/value-change and never
// clears them on unmount; draining here (before jsdom tears down) avoids an
// unhandled "window is not defined" from a stray callback (see
// ProUpgrade3Compliance.test.tsx for the same drain).
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
})

describe('PinDialog', () => {
  it('renders nothing when not awaiting a PIN, only a Close button', async () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.NOT_AWAITING_PIN,
      pinDelivery: null,
    })
    const onOpenChange = vi.fn()
    render(<PinDialog open onOpenChange={onOpenChange} tcrCompliance={null} />)

    expect(getFooterCloseButton()).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'PIN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verify PIN' })).toBeNull()

    await userEvent.click(getFooterCloseButton())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a spinner while loading', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.LOADING,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(screen.queryByRole('textbox', { name: 'PIN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verify PIN' })).toBeNull()
  })

  it('shows the in-progress notice and no Verify PIN button while verification is in progress', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.VERIFICATION_IN_PROGRESS,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(
      screen.getByText('Your registration is being verified'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify PIN' })).toBeNull()
  })

  it('disables Verify PIN until six digits are entered, then submits the PIN', async () => {
    const user = userEvent.setup()
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(screen.getByRole('button', { name: 'Verify PIN' })).toBeDisabled()

    await user.type(getPinInput(), '123456')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Verify PIN' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'Verify PIN' }))

    expect(mockSubmit).toHaveBeenCalledWith('123456')
  })

  // A verified PIN is not the same event as the dialog closing. A caller
  // that has something to do next — the outreach gate has a text to hand
  // back — takes it here instead of reading the close.
  it('reports a verified PIN through onSuccess instead of closing', async () => {
    const user = userEvent.setup()
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    mockUseSubmitCvPin.mockImplementation(
      (
        _tcrCompliance: TcrCompliance | null,
        options: { onSuccess: () => void },
      ) => ({
        submit: async () => options.onSuccess(),
        submitting: false,
        error: null,
      }),
    )
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    render(
      <PinDialog
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        tcrCompliance={null}
      />,
    )

    await user.type(getPinInput(), '123456')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Verify PIN' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Verify PIN' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // The membership banner and chip pass none, and must keep closing.
  it('still closes on success when no onSuccess is given', async () => {
    const user = userEvent.setup()
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    mockUseSubmitCvPin.mockImplementation(
      (
        _tcrCompliance: TcrCompliance | null,
        options: { onSuccess: () => void },
      ) => ({
        submit: async () => options.onSuccess(),
        submitting: false,
        error: null,
      }),
    )
    const onOpenChange = vi.fn()
    render(<PinDialog open onOpenChange={onOpenChange} tcrCompliance={null} />)

    await user.type(getPinInput(), '123456')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Verify PIN' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Verify PIN' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('falls back to the generic PIN copy when no delivery is reported', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(
      screen.getByText(
        'We send a PIN to the email, phone, or address on your campaign filing.',
      ),
    ).toBeInTheDocument()
  })

  it('describes the real delivery channel when Peerly reports it', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: { method: 'text', displayString: '(312) •••-1162' },
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(
      screen.getByText('We sent your PIN by text to (312) •••-1162.'),
    ).toBeInTheDocument()
  })

  it('calls onOpenChange(false) when Later is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={onOpenChange} tcrCompliance={null} />)

    await user.click(screen.getByRole('button', { name: 'Later' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the submit error from useSubmitCvPin', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    mockUseSubmitCvPin.mockReturnValue({
      submit: mockSubmit,
      submitting: false,
      error: 'That PIN didn’t match. Double-check and try again.',
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That PIN didn’t match. Double-check and try again.',
    )
  })

  it('fires PinEntryViewed when the dialog opens', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    render(<PinDialog open onOpenChange={vi.fn()} tcrCompliance={null} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.PinEntryViewed,
    )
  })

  it('does not fire PinEntryViewed when the dialog is closed', () => {
    mockUseCvPinGate.mockReturnValue({
      state: CV_PIN_GATE.READY,
      pinDelivery: null,
    })
    render(
      <PinDialog open={false} onOpenChange={vi.fn()} tcrCompliance={null} />,
    )

    expect(trackEvent).not.toHaveBeenCalled()
  })
})
