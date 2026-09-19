import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhoneBankingCreate } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { PhoneBankingFlow } from './PhoneBankingFlow'
import type { OutreachGateState } from '../gate/useOutreachGate'
import { gateRef } from '../gate/testing/mockReactiveGate'

// Same convention as the other flow tests: the gate's own flag/membership
// plumbing has its own tests, so the hook is driven directly through the
// shared reactive stand-in.
vi.mock('../gate/useOutreachGate', async () => {
  const { useMockOutreachGate } =
    await import('../gate/testing/mockReactiveGate')
  return { useOutreachGate: useMockOutreachGate }
})

// Mounts real Stripe surfaces; the flow only owns whether it is on screen and
// what its completion runs, so the stand-in exposes the completion as a
// button.
vi.mock('app/dashboard/pro-upgrade/components/ProUpgradeFlow', () => ({
  default: ({
    onComplete,
    onExit,
  }: {
    onComplete: () => void
    onExit: () => void
  }) => (
    <div data-testid="pro-upgrade-flow">
      <button type="button" onClick={onComplete}>
        Finish upgrade
      </button>
      <button type="button" onClick={onExit}>
        Finish later
      </button>
    </div>
  ),
}))

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
    toggle: vi.fn(),
  }),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const FREE_GATE: OutreachGateState = {
  enabled: true,
  requirement: 'pro',
  twoStep: false,
  membership: {
    tier: 'free',
    texting: 'needs_verification',
    pinDelivery: null,
    isElectedOffice: false,
  },
  tcrCompliance: null,
}

const PRO_GATE: OutreachGateState = {
  enabled: true,
  requirement: null,
  twoStep: false,
  membership: {
    tier: 'pro',
    texting: 'cleared',
    pinDelivery: null,
    isElectedOffice: false,
  },
  tcrCompliance: null,
}

const GATE_LINE =
  'Pro is needed to see voter names and phone numbers on this list.'

const createResponse = {
  id: 5,
  name: 'Get out the vote',
  sheetCount: 1,
  entryCount: 12,
  personCount: 42,
  outreachId: 9,
  hasMore: false,
}

const user = userEvent.setup()

const mockCreateList = () => {
  const calls: PhoneBankingCreate[] = []
  api.mock('POST /v1/phone-banking/lists', ({ body }) => {
    calls.push(body)
    return { status: 200, data: createResponse }
  })
  return calls
}

const advanceToSheets = async () => {
  await user.click(screen.getByText('Introduce myself to voters'))
  await screen.findAllByText('Who do you want to reach?')
  await user.click(screen.getByText('Choose a voter list'))
  await user.click(await screen.findByText('Likely Dems'))
  await user.click(
    await screen.findByRole('button', { name: /Continue \([\d,]+\)/ }),
  )
  await screen.findAllByText('Write your call script')
  await waitFor(() =>
    expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findAllByText(
    'How many call sheets would you like me to create?',
  )
}

describe('PhoneBankingFlow — the Pro gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateRef.set(PRO_GATE)
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 3, name: 'Likely Dems' }],
    })
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 42 } })
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/contacts/list-detail', {
      status: 200,
      data: {
        demographics: { people: 20, avgAge: null, avgIncome: null },
        reachability: {
          sms: null,
          robocall: null,
          phoneBanking: 10,
          doorKnocking: null,
          polls: null,
        },
        outreachHistory: [],
      },
    })
    api.mock('POST /v1/outreach/phone-banking/draft', {
      status: 200,
      data: { draft: 'AI script for phone banking' },
    })
  })

  it('shows the gate banner on every step for a free candidate', async () => {
    gateRef.set(FREE_GATE)
    render(<PhoneBankingFlow open onClose={vi.fn()} />)

    expect(await screen.findByText(GATE_LINE)).toBeInTheDocument()

    await advanceToSheets()

    expect(screen.getByText(GATE_LINE)).toBeInTheDocument()
  })

  it('free candidate: the sheets Continue opens the gate instead of creating the list', async () => {
    gateRef.set(FREE_GATE)
    const createCalls = mockCreateList()
    render(<PhoneBankingFlow open onClose={vi.fn()} />)
    await advanceToSheets()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
    expect(createCalls).toHaveLength(0)
  })

  // The requirement clears the instant payment lands, while the upgrade's
  // own success screen is still up. The gate latches its screen, so that
  // flip must leave the candidate exactly where they were — the Continue
  // they are about to press is what creates the list.
  it('free candidate: the requirement clearing mid-upgrade leaves the gate up, and its completion creates the list', async () => {
    gateRef.set(FREE_GATE)
    const createCalls = mockCreateList()
    render(<PhoneBankingFlow open onClose={vi.fn()} />)
    await advanceToSheets()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('pro-upgrade-flow')

    act(() => gateRef.set(PRO_GATE))

    expect(screen.getByTestId('pro-upgrade-flow')).toBeInTheDocument()
    expect(createCalls).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Finish upgrade' }))

    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(screen.queryByTestId('pro-upgrade-flow')).not.toBeInTheDocument()
    expect(
      (await screen.findAllByText('Your call sheet is ready')).length,
    ).toBeGreaterThan(0)
  })

  it('free candidate: leaving the gate lands back on the sheets step', async () => {
    gateRef.set(FREE_GATE)
    const onClose = vi.fn()
    render(<PhoneBankingFlow open onClose={onClose} />)
    await advanceToSheets()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('pro-upgrade-flow')

    await user.click(screen.getByRole('button', { name: 'Finish later' }))

    expect(
      (
        await screen.findAllByText(
          'How many call sheets would you like me to create?',
        )
      ).length,
    ).toBeGreaterThan(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  // The banner rides every step, so its explainer can open the gate long
  // before the candidate has reached the one write this flow makes. Finishing
  // there must hand them back the step they were on, not buy a list they
  // never asked for.
  it('free candidate: upgrading from the banner creates nothing and keeps the step', async () => {
    gateRef.set(FREE_GATE)
    const createCalls = mockCreateList()
    render(<PhoneBankingFlow open onClose={vi.fn()} />)

    // Stop on the script step: the audience is picked, so a create fired
    // from here would really post — the purpose step would have thrown
    // before the request and hidden the bug.
    await user.click(screen.getByText('Introduce myself to voters'))
    await screen.findAllByText('Who do you want to reach?')
    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Likely Dems'))
    await user.click(
      await screen.findByRole('button', { name: /Continue \([\d,]+\)/ }),
    )
    await screen.findAllByText('Write your call script')

    await user.click(await screen.findByText(GATE_LINE))
    await user.click(
      await screen.findByRole('button', { name: 'Upgrade to Pro' }),
    )
    expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

    act(() => gateRef.set(PRO_GATE))
    await user.click(screen.getByRole('button', { name: 'Finish upgrade' }))

    expect(
      (await screen.findAllByText('Write your call script')).length,
    ).toBeGreaterThan(0)
    expect(createCalls).toHaveLength(0)
  })

  it('Pro candidate: the sheets Continue creates the list, with no banner', async () => {
    const createCalls = mockCreateList()
    render(<PhoneBankingFlow open onClose={vi.fn()} />)
    await advanceToSheets()

    expect(screen.queryByText(GATE_LINE)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(screen.queryByTestId('pro-upgrade-flow')).not.toBeInTheDocument()
  })
})
