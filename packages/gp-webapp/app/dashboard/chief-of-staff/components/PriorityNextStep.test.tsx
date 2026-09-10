import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Priority, PriorityStage } from '@goodparty_org/contracts'
import PriorityNextStep from './PriorityNextStep'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => '/dashboard/chief-of-staff',
  useSearchParams: () => new URLSearchParams(),
}))

// The real flow is a full-screen sheet with its own steps and network calls;
// this asserts that it is mounted inline and handed Serve's surface, which is
// the part that matters here.
const flowPropsMock = vi.fn()
vi.mock('app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow', () => ({
  PhoneBankingFlow: (props: { open: boolean }) => {
    flowPropsMock(props)
    return props.open ? <div data-testid="phone-banking-flow" /> : null
  },
  SERVE_PHONE_BANKING_SURFACE: { id: 'serve-surface' },
}))

const priority = (
  stage: PriorityStage,
): Priority & { stage: PriorityStage } => ({
  id: 'p1',
  electedOfficeId: 'eo1',
  title: 'Short-term rentals',
  description: 'Rents climbing as units convert to nightly stays.',
  source: 'community_issue',
  sourceCampaignPositionId: null,
  stage,
  targetDate: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
})

beforeEach(() => {
  pushMock.mockReset()
  flowPropsMock.mockReset()
})

describe('PriorityNextStep', () => {
  it('offers both channels against the named priority', () => {
    render(<PriorityNextStep priority={priority('exploring')} />)

    expect(screen.getByText(/On short-term rentals/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Call constituents about this/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Knock doors about this/ }),
    ).toBeInTheDocument()
  })

  // The channels are the same at every stage; what changes is why.
  it.each([
    ['exploring' as const, /hear it straight from the people it affects/],
    ['gathering_input' as const, /widening that/],
    ['shaping' as const, /testing it on the people who will live with it/],
    ['ready_for_vote' as const, /a vote is won before the meeting/],
  ])('frames the ask for the %s stage', (stage, copy) => {
    render(<PriorityNextStep priority={priority(stage)} />)

    expect(screen.getByText(copy, { exact: false })).toBeInTheDocument()
  })

  // Phone banking opens over the conversation rather than navigating away.
  it('mounts the phone banking flow inline on Serve"s surface', async () => {
    const user = userEvent.setup()
    render(<PriorityNextStep priority={priority('shaping')} />)

    expect(screen.queryByTestId('phone-banking-flow')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Call constituents about this/ }),
    )

    expect(screen.getByTestId('phone-banking-flow')).toBeInTheDocument()
    expect(flowPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        surface: { id: 'serve-surface' },
      }),
    )
    expect(pushMock).not.toHaveBeenCalled()
  })

  // Door knocking cannot mount inline: its create wizard draws over the
  // district map, which is a route. `?create=1` matches what the Serve
  // outreach hub's own tile does.
  it('navigates to the map for door knocking', async () => {
    const user = userEvent.setup()
    render(<PriorityNextStep priority={priority('gathering_input')} />)

    await user.click(
      screen.getByRole('button', { name: /Knock doors about this/ }),
    )

    expect(pushMock).toHaveBeenCalledWith('/dashboard/door-knocking?create=1')
    expect(screen.queryByTestId('phone-banking-flow')).not.toBeInTheDocument()
  })
})
