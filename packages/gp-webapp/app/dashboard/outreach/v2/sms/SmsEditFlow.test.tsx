import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { SmsEditFlow, type SmsEditTarget } from './SmsEditFlow'
import { updateOutreach } from 'gpApi/outreach.api'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle' as const,
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    { id: 9, isPro: true, details: { normalizedOffice: 'City Council' } },
    vi.fn(),
  ],
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 1, firstName: 'Jane' }, vi.fn(), false],
}))

vi.mock('gpApi/outreach.api', () => ({
  updateOutreach: vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    data: { id: 41 },
  })),
}))

// Same frozen-clock discipline as SmsFlow.test: the 48h floor and the
// prefilled send date must not drift with the real calendar.
const FROZEN_NOW = new Date('2026-09-01T12:00:00')

const target: SmsEditTarget = {
  id: 41,
  name: 'Likely voters — SMS',
  // 5 days out at 10:00 local — clears the 48h floor without touching the
  // calendar, so the prefill alone should enable Continue.
  date: new Date('2026-09-06T10:00:00'),
  script:
    "Hello {first_name}, it's Jane, running for City Council. Join us!\n\n" +
    'Reply STOP to opt out.',
  imageUrl: 'https://assets.example.org/scheduled-campaign/img.png',
  contactCount: 1200,
  audienceName: 'Likely voters',
}

const openEdit = (overrides: Partial<SmsEditTarget> = {}) => {
  const onClose = vi.fn()
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsEditFlow
      open
      target={{ ...target, ...overrides }}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  return { onClose, onSaved }
}

describe('SmsEditFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    api.mock('POST /v1/outreach/sms/draft', {
      status: 200,
      data: { draft: 'polished' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on the schedule step, prefilled, with no Back and no audience step', () => {
    openEdit()

    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Likely voters — SMS',
    )
    // First step of the edit flow — nothing to go back to, and the audience
    // is not editable, so no Back control renders at all.
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Who do you want to reach?'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('walks schedule → compose → review and saves without a payment step', async () => {
    const { onSaved } = openEdit()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Compose rehydrates the editable body — greeting and opt-out footer
    // stripped — and shows the stored image, so no "image required" hint.
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue(
      "it's Jane, running for City Council. Join us!",
    )
    expect(screen.getByAltText('Attachment preview')).toBeInTheDocument()
    expect(screen.queryByText(/An image is required/)).not.toBeInTheDocument()
    // Back exists between edit steps; it can only reach schedule.
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Review changes')).toBeInTheDocument()
    expect(screen.getByText(/Already paid/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Pay \$/ }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.getByText('Changes saved')).toBeInTheDocument(),
    )
    expect(updateOutreach).toHaveBeenCalledWith(
      41,
      expect.objectContaining({
        name: 'Likely voters — SMS',
        script:
          "Hello {first_name}, it's Jane, running for City Council. Join us!\n\n" +
          'Reply STOP to opt out.',
        date: expect.stringMatching(/^2026-09-06T10:00:00/),
      }),
      null,
    )
    expect(onSaved).toHaveBeenCalledWith(41)
  })

  it('blocks Continue when the stored image is removed until a new one is attached', async () => {
    openEdit()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }))

    expect(screen.getByText(/An image is required/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    const file = new File(['x'.repeat(100)], 'new.png', { type: 'image/png' })
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    await userEvent.upload(input, file)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('surfaces a save failure inline and lets the user retry', async () => {
    vi.mocked(updateOutreach).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      data: null,
    })
    const { onSaved } = openEdit()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText(/couldn't save your changes/),
    ).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByText('Changes saved')).toBeInTheDocument(),
    )
  })
})
