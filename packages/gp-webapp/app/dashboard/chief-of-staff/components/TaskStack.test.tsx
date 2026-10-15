import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { EXPLAIN_CIVIC_PANEL_MESSAGE } from '@goodparty_org/contracts'
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
      { cardId: 'c1', cardType: 'briefing', stackSize: 1, action: 'ask' },
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
      { cardId: 'c1', cardType: 'briefing', stackSize: 1, action: 'skip' },
    )
  })

  const buildCard = card({
    id: 'build',
    type: 'civic_panel',
    title: 'Start with the people you represent',
    summary:
      'A civic panel is residents who agree to tell you what they think before you decide.',
    ctaLabel: 'Build my panel',
    ctaHref: '/dashboard/chief-of-staff?chat=build_citizens_panel',
    dueDate: '2026-10-21T18:00:00.000Z',
    sourceExternalId: 'build:eo-1',
  })

  it('offers no Ask about this on a civic panel card', () => {
    withCards([buildCard])
    render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: 'Ask about this' }),
    ).not.toBeInTheDocument()
  })

  it('explains the panel from the build card without building or finishing anything', async () => {
    const user = userEvent.setup()
    const onDiscussCard = vi.fn()
    onboardingRef.current = [{ key: 'meet', status: 'completed' }]
    withCards([buildCard])
    render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={onDiscussCard} />)
    // A quiet link beside the one primary action.
    const explain = screen.getByRole('button', {
      name: "What's a civic panel?",
    })
    await user.click(explain)
    expect(onDiscussCard).toHaveBeenCalledWith(EXPLAIN_CIVIC_PANEL_MESSAGE)
    expect(completeMock).not.toHaveBeenCalled()
    expect(completeOnboardingMock).not.toHaveBeenCalled()
    expect(dismissMock).not.toHaveBeenCalled()
  })

  it('offers What is a civic panel only on the build card', () => {
    withCards([
      card({
        id: 'p1-card',
        type: 'civic_panel',
        title: 'Affordable housing',
        ctaLabel: 'Open priority',
        ctaHref: '/dashboard/priorities/p1',
        sourceExternalId: 'p1',
      }),
    ])
    render(<TaskStack onOpenCard={vi.fn()} onDiscussCard={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: "What's a civic panel?" }),
    ).not.toBeInTheDocument()
  })

  it('shows no due date on the build card', () => {
    withCards([buildCard])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(screen.queryByText(/October 21/)).toBeNull()
  })

  const frontTitle = () => screen.getByRole('heading', { level: 3 }).textContent

  it('leads with meet, then the build card, then priorities, then the rest', () => {
    onboardingRef.current = [
      { key: 'meet', status: 'active' },
      { key: 'priorities', status: 'active' },
    ]
    withCards([card({}), buildCard])
    const { rerender } = render(<TaskStack onOpenCard={vi.fn()} />)
    expect(frontTitle()).toBe(ONBOARDING_CARDS.meet.title)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Start here' }),
    ).toBeInTheDocument()

    onboardingRef.current = [
      { key: 'meet', status: 'completed' },
      { key: 'priorities', status: 'active' },
    ]
    rerender(<TaskStack onOpenCard={vi.fn()} />)
    expect(frontTitle()).toBe('Start with the people you represent')
    expect(
      screen.getByRole('heading', { level: 2, name: 'People first' }),
    ).toBeInTheDocument()
    // Build my panel stays on the home: it opens the chat there, never the
    // outreach page.
    expect(
      screen.getByRole('link', { name: 'Build my panel' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/chief-of-staff?chat=build_citizens_panel',
    )

    withCards([card({})])
    rerender(<TaskStack onOpenCard={vi.fn()} />)
    expect(frontTitle()).toBe(ONBOARDING_CARDS.priorities.title)

    onboardingRef.current = [
      { key: 'meet', status: 'completed' },
      { key: 'priorities', status: 'skipped' },
    ]
    rerender(<TaskStack onOpenCard={vi.fn()} />)
    expect(frontTitle()).toBe('Prep for the zoning vote')
  })

  it('puts the build card ahead of priorities once meet is skipped', () => {
    onboardingRef.current = [
      { key: 'meet', status: 'skipped' },
      { key: 'priorities', status: 'active' },
    ]
    withCards([buildCard])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(frontTitle()).toBe('Start with the people you represent')
  })

  // It is done when its text goes out, not when it is pressed.
  it('offers no Mark done on the build card, with the priorities stacked under it', async () => {
    const user = userEvent.setup()
    withCards([
      card({
        id: 'p1-card',
        type: 'civic_panel',
        title: 'Affordable housing',
        ctaLabel: 'Open priority',
        ctaHref: '/dashboard/priorities/p1',
        dueDate: '2026-10-01T18:00:00.000Z',
        sourceExternalId: 'p1',
      }),
      buildCard,
    ])
    render(<TaskStack onOpenCard={vi.fn()} />)
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Start with the people you represent',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /mark done/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Build my panel' }))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ChiefOfStaff.TaskActionTaken,
      expect.objectContaining({ cardId: 'build', stackSize: 2 }),
    )
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('puts the build card off for 3 days from Skip', async () => {
    const user = userEvent.setup()
    withCards([buildCard, card({})])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    )
    expect(snoozeMock).toHaveBeenCalledWith('build')
    expect(dismissMock).not.toHaveBeenCalled()
  })

  it('sets the build card aside with Not for me', async () => {
    const user = userEvent.setup()
    withCards([buildCard])
    render(<TaskStack onOpenCard={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Not for me' }),
    )
    expect(dismissMock).toHaveBeenCalledWith('build')
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
      sourceExternalId: '77',
    })

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
  })

  it('does not explain the system or use an em-dash', () => {
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    withCards([card({})])
    const { container } = render(<TaskStack onOpenCard={vi.fn()} />)
    expect(container.textContent).not.toContain('—')
  })
})
