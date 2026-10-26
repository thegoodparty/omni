import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA,
  MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE,
  START_MANAGED_CIVIC_PANEL_MESSAGE,
} from '@goodparty_org/contracts'
import TaskStack from './TaskStack'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import type { DashboardCard, OnboardingCard } from '../data/contracts'

const cardsRef: {
  current: { data?: DashboardCard[]; isPending: boolean; isError: boolean }
} = { current: { data: [], isPending: false, isError: false } }
const onboardingRef: { current: OnboardingCard[] | undefined } = {
  current: [],
}
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const orgRef: {
  current: { slug: string; district: { l2Name: string } | null }
} = { current: { slug: 'eo-test', district: null } }
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => orgRef.current,
}))

const dismissMock = vi.fn()
const completeMock = vi.fn()
const snoozeMock = vi.fn()
const skipOnboardingMock = vi.fn()
const completeOnboardingMock = vi.fn()

vi.mock('../data/use-dashboard', () => ({
  useDashboardCards: () => cardsRef.current,
  useOnboardingCards: () => ({ data: onboardingRef.current }),
  useDismissCard: () => ({ mutate: dismissMock }),
  useCompleteCard: () => ({ mutate: completeMock }),
  useSnoozeCard: () => ({ mutate: snoozeMock }),
  useSkipOnboardingCard: () => ({ mutate: skipOnboardingMock }),
  useCompleteOnboardingCard: () => ({ mutate: completeOnboardingMock }),
}))

const card = (overrides: Partial<DashboardCard>): DashboardCard => ({
  id: 'c1',
  type: 'briefing',
  title: 'Prep for the zoning vote',
  summary: 'Three items worth reading first.',
  ctaLabel: 'Prepare for the meeting',
  ctaHref: '/dashboard/briefings/2026-09-21',
  dueDate: '2026-09-21T18:00:00.000Z',
  sourceExternalId: 'ext-1',
  sourceItemId: null,
  dismissedAt: null,
  completedAt: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
})

const withCards = (data: DashboardCard[]) => {
  cardsRef.current = { data, isPending: false, isError: false }
}

beforeEach(() => {
  orgRef.current = { slug: 'eo-test', district: null }
  cardsRef.current = { data: [], isPending: false, isError: false }
  onboardingRef.current = []
  dismissMock.mockReset()
  completeMock.mockReset()
  snoozeMock.mockReset()
  skipOnboardingMock.mockReset()
  completeOnboardingMock.mockReset()
  vi.mocked(trackEvent).mockReset()
})

describe('<TaskStack>', () => {
  it('names a next step when there is genuinely nothing to do', () => {
    render(<TaskStack onOpenCard={vi.fn()} />)
    const empty = screen.getByTestId('task-list-empty')
    expect(empty).toHaveTextContent('No tasks this week')
    // docs/product-copy.md rule 8: what happened, then what to do.
    expect(empty).toHaveTextContent(/ask your chief of staff/i)
  })

  // The dashboard's own copy must not say the thing the agent is forbidden
  // from saying (see the PROACTIVITY block in chiefOfStaffPrompt.ts).
  it('never claims the user is all caught up', () => {
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it('stays silent while a briefing is generating', () => {
    const { container } = render(
      <TaskStack onOpenCard={vi.fn()} briefingInFlight />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('waits for the get-started cards before showing anything', () => {
    onboardingRef.current = undefined
    withCards([card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(screen.getByTestId('task-list-loading')).toBeInTheDocument()
  })

  it('shows only the front card, get-started cards first', () => {
    onboardingRef.current = [
      { key: 'meet', status: 'active' },
      { key: 'priorities', status: 'completed' },
    ]
    withCards([card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(screen.getByText(ONBOARDING_CARDS.meet.title)).toBeInTheDocument()
    expect(
      screen.queryByText(ONBOARDING_CARDS.priorities.title),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Prep for the zoning vote'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Start here' }),
    ).toBeInTheDocument()
  })

  it('opens the chat from a get-started card and offers no Mark done', async () => {
    const user = userEvent.setup()
    const onOpenCard = vi.fn()
    onboardingRef.current = [{ key: 'priorities', status: 'active' }]
    render(<TaskStack onOpenCard={onOpenCard} />)
    await user.click(
      screen.getByRole('button', {
        name: ONBOARDING_CARDS.priorities.ctaLabel,
      }),
    )
    expect(onOpenCard).toHaveBeenCalledWith('priorities')
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ChiefOfStaff.TaskActionTaken,
      {
        cardId: 'onboarding:priorities',
        cardType: 'onboarding',
        cardVariant: 'other',
        stackSize: 1,
        action: 'start',
        cta: ONBOARDING_CARDS.priorities.ctaLabel,
      },
    )
    expect(
      screen.queryByRole('button', { name: /mark done/i }),
    ).not.toBeInTheDocument()
    // Priorities is done by stating one, not by opening it.
    expect(completeOnboardingMock).not.toHaveBeenCalled()
  })

  // Any Chief of Staff conversation must not stand in for the intro.
  it('completes the meet card when its button opens the intro', async () => {
    const user = userEvent.setup()
    const onOpenCard = vi.fn()
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    render(<TaskStack onOpenCard={onOpenCard} />)
    await user.click(
      screen.getByRole('button', { name: ONBOARDING_CARDS.meet.ctaLabel }),
    )
    expect(completeOnboardingMock).toHaveBeenCalledWith('meet')
    expect(onOpenCard).toHaveBeenCalledWith('meet')
  })

  it('skips a get-started card through its own mutation', async () => {
    const user = userEvent.setup()
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(skipOnboardingMock).toHaveBeenCalledWith('meet')
    expect(dismissMock).not.toHaveBeenCalled()
  })

  it('asks the chief of staff about the front card', async () => {
    const user = userEvent.setup()
    const onDiscussCard = vi.fn()
    withCards([card({})])
    render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={onDiscussCard} />)
    await user.click(screen.getByRole('button', { name: 'Ask about this' }))
    expect(onDiscussCard).toHaveBeenCalledWith(
      expect.stringContaining('"Prep for the zoning vote"'),
    )
    expect(onDiscussCard.mock.calls[0]?.[0]).toContain(
      'Three items worth reading first.',
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ChiefOfStaff.TaskActionTaken,
      {
        cardId: 'c1',
        cardType: 'briefing',
        cardVariant: 'other',
        stackSize: 1,
        action: 'ask',
      },
    )
  })

  it('offers no Ask about this on a get-started card', () => {
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: 'Ask about this' }),
    ).not.toBeInTheDocument()
  })

  it('links the primary action to the card destination', () => {
    withCards([card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(
      screen.getByRole('link', { name: 'Prepare for the meeting' }),
    ).toHaveAttribute('href', '/dashboard/briefings/2026-09-21')
    expect(
      screen.getByRole('heading', { name: 'Get ready for your next meeting' }),
    ).toBeInTheDocument()
  })

  it('marks the front card done on the first press', async () => {
    const user = userEvent.setup()
    withCards([card({}), card({ id: 'c2', title: 'Second' })])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /mark done/i }))
    expect(completeMock).toHaveBeenCalledWith('c1')
    expect(dismissMock).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.ChiefOfStaff.TaskCompleted, {
      cardId: 'c1',
      cardType: 'briefing',
      cardVariant: 'other',
      stackSize: 2,
    })
  })

  it('skips the front card through dismiss', async () => {
    const user = userEvent.setup()
    withCards([card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(dismissMock).toHaveBeenCalledWith('c1')
    expect(completeMock).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ChiefOfStaff.TaskActionTaken,
      {
        cardId: 'c1',
        cardType: 'briefing',
        cardVariant: 'other',
        stackSize: 1,
        action: 'skip',
        skipChoice: 'dismiss',
      },
    )
  })

  // The panel card GoodParty builds, offered until the official approves it.
  const panelCard = card({
    id: 'panel',
    type: 'civic_panel',
    title: 'Know what your district thinks before you vote',
    summary:
      'Residents from every part of your district, matched by age, ' +
      'gender and race. Free in early access.',
    ctaLabel: 'Build my civic panel',
    ctaHref: '/dashboard/contacts/citizens-panel',
    dueDate: '2026-10-21T18:00:00.000Z',
    sourceExternalId: 'managed-panel:eo-1',
  })

  const frontTitle = () => screen.getByRole('heading', { level: 3 }).textContent

  it('puts the panel card off for 3 days from Skip', async () => {
    const user = userEvent.setup()
    withCards([panelCard, card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    )
    expect(snoozeMock).toHaveBeenCalledWith('panel')
    expect(dismissMock).not.toHaveBeenCalled()
  })

  it('sets the panel card aside with Not for me', async () => {
    const user = userEvent.setup()
    withCards([panelCard])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Not for me' }),
    )
    expect(dismissMock).toHaveBeenCalledWith('panel')
    expect(snoozeMock).not.toHaveBeenCalled()
  })

  // It stays until its priority is resolved, so it offers no Mark done.
  it("reads a priority card as the priority's next step, with no Mark done", async () => {
    const user = userEvent.setup()
    withCards([
      card({
        id: 'p1-card',
        type: 'civic_panel',
        title: 'Affordable housing',
        summary: 'Draft two options for the council.',
        ctaLabel: 'Open priority',
        ctaHref: '/dashboard/priorities/p1',
        sourceExternalId: 'p1',
      }),
    ])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(
      screen.getByRole('heading', {
        name: 'Next steps on your priorities',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Draft two options for the council.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open priority' })).toHaveAttribute(
      'href',
      '/dashboard/priorities/p1',
    )
    expect(
      screen.queryByRole('button', { name: /mark done/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    )
    expect(snoozeMock).toHaveBeenCalledWith('p1-card')
    expect(completeMock).not.toHaveBeenCalled()
  })

  describe('the report back card', () => {
    const reportBack = card({
      id: 'rb',
      type: 'report_back',
      title: 'Show people their voice counted on Downtown parking',
      summary: 'People keep answering when they see what came of it.',
      ctaLabel: 'Report back',
      ctaHref: '/dashboard/priorities/p1?reportBack=77',
      sourceExternalId: 'p1',
      sourceItemId: 'notYetRepresentative',
    })
    const goodReadReportBack = { ...reportBack, sourceItemId: 'representative' }

    it('opens the priority to report back, with Mark done', async () => {
      const user = userEvent.setup()
      withCards([reportBack])
      render(<TaskStack onOpenCard={vi.fn()} />)
      expect(
        screen.getByRole('heading', {
          name: 'Show people their voice counted on Downtown parking',
        }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Report back' })).toHaveAttribute(
        'href',
        '/dashboard/priorities/p1?reportBack=77',
      )
      await user.click(screen.getByRole('button', { name: /mark done/i }))
      expect(completeMock).toHaveBeenCalledWith('rb')
    })

    it('puts it off for 3 days from Skip', async () => {
      const user = userEvent.setup()
      withCards([reportBack, card({})])
      render(<TaskStack onOpenCard={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
      )
      expect(snoozeMock).toHaveBeenCalledWith('rb')
      expect(dismissMock).not.toHaveBeenCalled()
    })

    it('sets it aside with Not for me', async () => {
      const user = userEvent.setup()
      withCards([reportBack])
      render(<TaskStack onOpenCard={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'Not for me' }),
      )
      expect(dismissMock).toHaveBeenCalledWith('rb')
    })

    const step = card({
      id: 'step',
      type: 'civic_panel',
      title: 'Your civic panel is filling up',
      ctaLabel: 'See your civic panel',
      ctaHref: '/dashboard/contacts/citizens-panel',
      sourceExternalId: 'managed-panel-progress:eo-1',
      sourceItemId: 'building',
    })

    it('leads the managed panel cards, after meet, once the read is good', () => {
      onboardingRef.current = [
        { key: 'meet', status: 'active' },
        { key: 'priorities', status: 'active' },
      ]
      withCards([card({}), panelCard, goodReadReportBack])
      const { rerender } = render(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(ONBOARDING_CARDS.meet.title)

      onboardingRef.current = [
        { key: 'meet', status: 'completed' },
        { key: 'priorities', status: 'active' },
      ]
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(reportBack.title)
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Tell people what you heard',
        }),
      ).toBeInTheDocument()

      withCards([step, card({}), goodReadReportBack])
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(reportBack.title)

      // Enough answers is a good read too.
      withCards([
        step,
        card({}),
        { ...reportBack, sourceItemId: 'enoughAnswers' },
      ])
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(reportBack.title)

      // Once it is snoozed or sent, the panel card is next.
      withCards([step, card({})])
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe('Your civic panel is filling up')
    })

    it('waits behind the panel cards with the rest before the read is good', () => {
      onboardingRef.current = [
        { key: 'meet', status: 'active' },
        { key: 'priorities', status: 'active' },
      ]
      withCards([reportBack, panelCard])
      const { rerender } = render(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(ONBOARDING_CARDS.meet.title)

      onboardingRef.current = [
        { key: 'meet', status: 'completed' },
        { key: 'priorities', status: 'active' },
      ]
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(panelCard.title)

      for (const sourceItemId of ['tooEarly', 'gettingClose']) {
        withCards([{ ...reportBack, sourceItemId }, step])
        rerender(<TaskStack onOpenCard={vi.fn()} />)
        expect(frontTitle()).toBe('Your civic panel is filling up')
      }

      // The get-started card comes next, then the report back.
      withCards([reportBack])
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(ONBOARDING_CARDS.priorities.title)

      onboardingRef.current = [
        { key: 'meet', status: 'completed' },
        { key: 'priorities', status: 'completed' },
      ]
      rerender(<TaskStack onOpenCard={vi.fn()} />)
      expect(frontTitle()).toBe(reportBack.title)
    })

    // At 375px its three quiet buttons (Mark done, Ask about this, Skip) are
    // wider than the card, so the row wraps rather than running off the
    // right edge. jsdom has no layout, so this pins the classes that do it.
    it('wraps its buttons inside the card on a phone', () => {
      withCards([reportBack])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)

      const row = screen.getByTestId('task-card-actions')
      expect(row).toHaveClass('flex', 'flex-wrap')
      const quiet = [
        screen.getByRole('button', { name: /mark done/i }),
        screen.getByRole('button', { name: 'Ask about this' }),
        screen.getByRole('button', { name: 'Skip' }),
      ]
      for (const button of quiet) {
        expect(row).toContainElement(button)
        expect(button).toHaveClass('max-sm:grow')
        expect(button).not.toHaveClass('max-sm:flex-1')
      }
      expect(screen.getByRole('link', { name: 'Report back' })).toHaveClass(
        'w-full',
      )
    })
  })

  describe('the managed civic panel card', () => {
    const managedCard = card({
      id: 'managed-1',
      type: 'civic_panel',
      title: 'Know what your district thinks before you vote',
      summary:
        'Residents from every part of your district, matched by age, ' +
        'gender and race. Free in early access.',
      ctaLabel: 'Build my civic panel',
      ctaHref: '/dashboard/contacts/citizens-panel',
      sourceExternalId: 'managed-panel:office-1',
    })

    it('leads under Every group gets a seat, naming the place', () => {
      orgRef.current = {
        slug: 'eo-test',
        district: { l2Name: 'Maplewood City Ward 2' },
      }
      onboardingRef.current = [{ key: 'priorities', status: 'active' }]
      withCards([managedCard])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)

      expect(
        screen.getByRole('heading', { name: 'Every group gets a seat' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', {
          name: 'Know what Maplewood thinks before you vote',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Residents from every part of Maplewood, matched by age, gender ' +
            'and race. Free in early access.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByTestId('managed-panel-seats')).toHaveAttribute(
        'role',
        'img',
      )
      expect(screen.queryByText(/due/i)).toBeNull()
    })

    it('title-cases a place that arrives in all caps', () => {
      orgRef.current = {
        slug: 'eo-test',
        district: { l2Name: 'WINSTON-SALEM CITY WARD 2' },
      }
      onboardingRef.current = [{ key: 'priorities', status: 'active' }]
      withCards([managedCard])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)

      expect(
        screen.getByRole('heading', {
          name: 'Know what Winston-Salem thinks before you vote',
        }),
      ).toBeInTheDocument()
    })

    it('opens the Chief of Staff on the setup, with Ask about this and Skip', async () => {
      const user = userEvent.setup()
      const onDiscussCard = vi.fn()
      withCards([managedCard])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={onDiscussCard} />)

      await user.click(
        screen.getByRole('button', { name: 'Build my civic panel' }),
      )
      expect(onDiscussCard).toHaveBeenCalledWith(
        START_MANAGED_CIVIC_PANEL_MESSAGE,
      )
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ChiefOfStaff.TaskActionTaken,
        expect.objectContaining({
          cardVariant: 'managed_offer',
          action: 'start',
        }),
      )

      await user.click(screen.getByRole('button', { name: 'Ask about this' }))
      expect(onDiscussCard).toHaveBeenLastCalledWith(
        expect.stringContaining(
          'Know what your district thinks before you vote',
        ),
      )
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull()
      expect(
        screen.queryByRole('button', { name: "What's a civic panel?" }),
      ).toBeNull()
      expect(screen.queryByRole('link')).toBeNull()
    })
  })

  describe('the managed civic panel progress card', () => {
    const progressCard = (
      phase: 'building' | 'ready' | 'exhausted',
      overrides: Partial<DashboardCard> = {},
    ) =>
      card({
        id: `progress-${phase}`,
        type: 'civic_panel',
        title: 'Your civic panel is filling up',
        summary:
          '12 of 250 residents have joined. More invites go out Tuesday, November 3.',
        ctaLabel: 'See your civic panel',
        ctaHref: '/dashboard/contacts/citizens-panel',
        sourceExternalId: 'managed-panel-progress:office-1',
        sourceItemId: phase,
        ...overrides,
      })

    it('leads under Your civic panel and opens the panel page', () => {
      onboardingRef.current = [{ key: 'priorities', status: 'active' }]
      withCards([card({ id: 'other' }), progressCard('building')])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)

      expect(
        screen.getByRole('heading', { name: 'Your civic panel' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          '12 of 250 residents have joined. More invites go out Tuesday, November 3.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'See your civic panel' }),
      ).toHaveAttribute(
        'href',
        expect.stringContaining('/dashboard/contacts/citizens-panel'),
      )
      expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull()
      expect(screen.queryByText(/due/i)).toBeNull()
    })

    it('opens the Chief of Staff on where the panel stands once invites run out', async () => {
      const user = userEvent.setup()
      const onDiscussCard = vi.fn()
      withCards([
        progressCard('exhausted', {
          title: 'Every resident we can text has an invite',
          summary: '12 of 250 residents have joined your civic panel.',
          ctaLabel: MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA,
        }),
      ])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={onDiscussCard} />)

      expect(screen.queryByText(/join link/i)).toBeNull()
      await user.click(
        screen.getByRole('button', { name: 'See where it stands' }),
      )

      expect(onDiscussCard).toHaveBeenCalledWith(
        MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE,
      )
      expect(screen.queryByRole('link')).toBeNull()
    })

    it('links the ready card to the panel page', () => {
      withCards([
        progressCard('ready', {
          title: 'Your civic panel is ready',
          summary:
            '250 residents said yes. Ask them what they think before your next vote.',
        }),
      ])
      render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)

      expect(
        screen.getByRole('heading', { name: 'Your civic panel is ready' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'See your civic panel' }),
      ).toBeInTheDocument()
    })
  })

  it('does not explain the system or use an em-dash', () => {
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    withCards([card({})])
    const { container } = render(<TaskStack onOpenCard={vi.fn()} />)
    expect(container.textContent).not.toContain('—')
  })

  describe('Task Viewed', () => {
    beforeEach(() => {
      testQueryClient.clear()
    })

    const viewed = () =>
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([event]) => event === EVENTS.ChiefOfStaff.TaskViewed,
        )
        .map(([, properties]) => properties)

    it('fires once for the front card, with the stack size', () => {
      withCards([card({}), card({ id: 'c2' })])
      const { rerender } = render(<TaskStack onOpenCard={vi.fn()} />)
      rerender(<TaskStack onOpenCard={vi.fn()} />)

      expect(viewed()).toEqual([
        { cardType: 'briefing', cardVariant: 'other', stackSize: 2 },
      ])
    })

    it('fires again when another card comes to the front', () => {
      withCards([card({}), card({ id: 'c2', type: 'agenda_item' })])
      const { rerender } = render(<TaskStack onOpenCard={vi.fn()} />)
      withCards([card({ id: 'c2', type: 'agenda_item' })])
      rerender(<TaskStack onOpenCard={vi.fn()} />)

      expect(viewed()).toEqual([
        expect.objectContaining({ cardType: 'briefing' }),
        expect.objectContaining({ cardType: 'agenda_item', stackSize: 1 }),
      ])
    })

    it("carries a report back's priority", () => {
      withCards([
        card({
          id: 'rb',
          type: 'report_back',
          sourceExternalId: 'p1',
          sourceItemId: 'tooEarly',
        }),
      ])
      render(<TaskStack onOpenCard={vi.fn()} />)

      expect(viewed()).toEqual([
        expect.objectContaining({
          cardType: 'report_back',
          cardVariant: 'report_back',
          priorityId: 'p1',
        }),
      ])
    })

    it("waits for a civic panel card's members and goal", async () => {
      api.mock('GET /v1/contacts/civic-panel', {
        status: 200,
        data: {
          members: 12,
          reachedRecently: 0,
          askableNow: 12,
          lastOutreachAt: null,
          progress: {
            members: 12,
            goal: 243,
            answersNeeded: 96,
            expectedAnswers: 5,
            groupsCovered: 1,
            groupsTotal: 12,
          },
          balance: null,
          composition: null,
        },
      })
      withCards([
        card({
          id: 'progress',
          type: 'civic_panel',
          title: 'Your civic panel is filling up',
          sourceExternalId: 'managed-panel-progress:eo-1',
          sourceItemId: 'building',
        }),
      ])
      render(<TaskStack onOpenCard={vi.fn()} />)

      await waitFor(() => expect(viewed()).toHaveLength(1))
      expect(viewed()[0]).toEqual({
        cardType: 'civic_panel',
        cardVariant: 'managed_building',
        stackSize: 1,
        members: 12,
        goalMembers: 243,
      })
    })
  })
})
