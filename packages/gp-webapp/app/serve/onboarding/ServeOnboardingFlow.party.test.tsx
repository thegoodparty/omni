import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
// Use the project render: it wraps a QueryClientProvider, which the resumed
// office step (ServeOfficePicker) needs once a returning EO resumes past welcome.
import { render } from 'helpers/test-utils/render'
import { clientRequest } from 'gpApi/typed-request'
import ServeOnboardingFlow from './ServeOnboardingFlow'
import { isServeMajorParty } from './serveOnboardingConfig'

// The flow fetches the user's elected office(s) on mount; returning not-ok for
// both keeps us on the net-new branch (no prefill) so we can drive the party
// step deterministically.
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }))
vi.mock('helpers/analyticsHelper', async () => {
  const actual = await vi.importActual<
    typeof import('helpers/analyticsHelper')
  >('helpers/analyticsHelper')
  return { ...actual, trackEvent }
})

const mockClientRequest = vi.mocked(clientRequest)

const renderFlow = () => render(<ServeOnboardingFlow />)

// welcome -> inOffice (pick "elected official") -> party
const advanceToParty = async () => {
  const continueButton = await screen.findByRole('button', {
    name: /continue/i,
  })
  fireEvent.click(continueButton)
  fireEvent.click(await screen.findByText("I'm an elected official"))
  fireEvent.click(continueButton)
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: /party designation/i,
    }),
  ).toBeInTheDocument()
}

describe('isServeMajorParty', () => {
  it('flags only the persisted major-party values', () => {
    expect(isServeMajorParty('democratic')).toBe(true)
    expect(isServeMajorParty('republican')).toBe(true)
    expect(isServeMajorParty('independent')).toBe(false)
    expect(isServeMajorParty('nonpartisan')).toBe(false)
    expect(isServeMajorParty(null)).toBe(false)
  })
})

describe('serve onboarding party step', () => {
  beforeEach(() => {
    mockClientRequest.mockReset()
    trackEvent.mockClear()
    // Both /current and /mine resolve not-ok -> net-new, no prefill.
    mockClientRequest.mockResolvedValue({ ok: false } as Awaited<
      ReturnType<typeof clientRequest>
    >)
  })

  it('blocks Continue and shows the partisan alert when a major party is selected', async () => {
    renderFlow()
    await advanceToParty()

    const continueButton = screen.getByRole('button', { name: /continue/i })
    // No party chosen yet.
    expect(continueButton).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Selecting Democrat surfaces the shared block message and keeps Continue
    // disabled, matching the Win flow's party-affiliation behavior.
    fireEvent.click(screen.getByText('Democrat'))
    expect(continueButton).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /only for non-partisan and independent candidates/i,
    )

    // A non-major pick clears the block and re-enables Continue.
    fireEvent.click(screen.getByText('Nonpartisan'))
    expect(continueButton).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('tracks the disqualification event once when a major party is picked', async () => {
    renderFlow()
    await advanceToParty()

    fireEvent.click(screen.getByText('Democrat'))
    fireEvent.click(screen.getByText('Republican'))

    const blockedCalls = trackEvent.mock.calls.filter(
      ([name]) => name === 'Serve Onboarding - Party Designation Blocked',
    )
    expect(blockedCalls).toHaveLength(1)
  })

  it('does not fire the disqualification event at load when a returning EO hydrates a major party', async () => {
    // A returning lead whose stored party is a major value would set `party`
    // via setParty(eo.party) on mount; the event must stay gated to the party
    // step so this load-time hydrate doesn't pollute the funnel.
    const mockImpl = ((endpoint: string) => {
      if (endpoint === 'GET /v1/elected-office/current') {
        return Promise.resolve({
          ok: true,
          data: { id: 'eo-1', party: 'democratic', selfReported: true },
        })
      }
      return Promise.resolve({ ok: false })
    }) as unknown as typeof clientRequest
    mockClientRequest.mockImplementation(mockImpl)

    renderFlow()
    // The party is already answered, so resume skips welcome/party and lands on
    // the (net-new) office step — the party-block effect is gated to the party
    // step, so it must not fire during this load-time hydration.
    expect(
      await screen.findByText('What office do you currently hold?'),
    ).toBeInTheDocument()

    const blockedAtLoad = trackEvent.mock.calls.filter(
      ([name]) => name === 'Serve Onboarding - Party Designation Blocked',
    )
    expect(blockedAtLoad).toHaveLength(0)
  })
})
