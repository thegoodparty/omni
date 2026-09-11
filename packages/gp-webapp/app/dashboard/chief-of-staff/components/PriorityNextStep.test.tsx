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

const ordinanceMock = vi.fn()
const startOrdinanceMock = vi.fn()
vi.mock('../data/use-priority-ordinance', () => ({
  usePriorityOrdinance: () => ordinanceMock(),
  ordinanceHref: (row: { slug: string; lastViewedStep: string | null }) =>
    `/dashboard/ordinances/solve/${row.slug}/${row.lastViewedStep ?? 'clarify'}`,
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
  startOrdinanceMock.mockReset()
  ordinanceMock.mockReturnValue({
    existing: undefined,
    isPending: false,
    start: startOrdinanceMock,
    isStarting: false,
    hasError: false,
  })
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

  describe('drafting', () => {
    // Before the official has landed on a solution, an ordinance CTA is asking
    // them to write something they have not decided on.
    it.each([['exploring' as const], ['gathering_input' as const]])(
      'does not offer drafting at the %s stage',
      (stage) => {
        render(<PriorityNextStep priority={priority(stage)} />)

        expect(
          screen.queryByRole('button', { name: /Draft the ordinance/ }),
        ).not.toBeInTheDocument()
      },
    )

    it.each([['shaping' as const], ['ready_for_vote' as const]])(
      'offers drafting at the %s stage',
      (stage) => {
        render(<PriorityNextStep priority={priority(stage)} />)

        expect(
          screen.getByRole('button', { name: /Draft the ordinance/ }),
        ).toBeInTheDocument()
      },
    )

    it('starts an ordinance seeded from the priority', async () => {
      const user = userEvent.setup()
      render(<PriorityNextStep priority={priority('shaping')} />)

      await user.click(
        screen.getByRole('button', { name: /Draft the ordinance/ }),
      )

      expect(startOrdinanceMock).toHaveBeenCalled()
    })

    // An ordinance seeded from a priority carries its title as goalText, so an
    // in-flight draft is findable — and must be resumed rather than duplicated.
    it('resumes an existing draft instead of starting a second', () => {
      ordinanceMock.mockReturnValue({
        existing: { slug: 'str-overlay', lastViewedStep: 'authority' },
        isPending: false,
        start: startOrdinanceMock,
        isStarting: false,
        hasError: false,
      })
      render(<PriorityNextStep priority={priority('shaping')} />)

      expect(
        screen.getByRole('link', { name: /Pick your draft back up/ }),
      ).toHaveAttribute(
        'href',
        '/dashboard/ordinances/solve/str-overlay/authority',
      )
      expect(
        screen.queryByRole('button', { name: /Draft the ordinance/ }),
      ).not.toBeInTheDocument()
    })

    // Offering "start one" before the lookup settles is how you get duplicates.
    it('offers neither while the lookup is still pending', () => {
      ordinanceMock.mockReturnValue({
        existing: undefined,
        isPending: true,
        start: startOrdinanceMock,
        isStarting: false,
        hasError: false,
      })
      render(<PriorityNextStep priority={priority('shaping')} />)

      expect(
        screen.queryByRole('button', { name: /Draft the ordinance/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /Pick your draft back up/ }),
      ).not.toBeInTheDocument()
      // The outreach options are unaffected by the ordinance lookup.
      expect(
        screen.getByRole('button', { name: /Call constituents about this/ }),
      ).toBeInTheDocument()
    })
  })

  // The lookup keys on sourcePriorityId now that seeding sets it. The goalText
  // fallback only exists for drafts created before that column, so a row that
  // carries an id must not be matched by text.
  it('resumes by source priority id, not by title text', () => {
    ordinanceMock.mockReturnValue({
      existing: { slug: 'by-id', lastViewedStep: null },
      isPending: false,
      start: startOrdinanceMock,
      isStarting: false,
      hasError: false,
    })
    render(<PriorityNextStep priority={priority('ready_for_vote')} />)

    expect(
      screen.getByRole('link', { name: /Pick your draft back up/ }),
    ).toHaveAttribute('href', '/dashboard/ordinances/solve/by-id/clarify')
  })
})
