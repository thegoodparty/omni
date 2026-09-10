import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DashboardCard, OnboardingCard } from '../data/contracts'
import ChiefOfStaffChatHome from './ChiefOfStaffChatHome'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/chief-of-staff',
  useSearchParams: () => new URLSearchParams(),
}))

const organizationMock = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => organizationMock(),
}))

const cardsMock = vi.fn()
const onboardingMock = vi.fn()
vi.mock('../data/use-dashboard', () => ({
  useDashboardCards: () => cardsMock(),
  useOnboardingCards: () => onboardingMock(),
}))

const prioritiesMock = vi.fn()
vi.mock('../data/use-priorities', () => ({
  usePriorities: () => prioritiesMock(),
}))

vi.mock('./PriorityChoiceStep', () => ({
  default: () => <div data-testid="priority-choice-step" />,
}))

vi.mock('../data/use-chat-history', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/use-chat-history')>()),
  useChatHistory: () => ({ data: [] }),
}))

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const streamMessageMock = vi.fn()

vi.mock('../data/chat-api', () => ({
  chiefOfStaffChatApi: {
    createConversation: (...args: unknown[]) => createMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: vi.fn().mockResolvedValue([]),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: vi.fn(),
  },
}))

const card = (over: Partial<DashboardCard> = {}): DashboardCard => ({
  id: 'card_1',
  type: 'briefing',
  title: 'Prepare for the Planning Commission meeting',
  summary:
    'Three agenda items touch the housing overlay you asked me to track.',
  ctaLabel: 'Open briefing',
  ctaHref: '/dashboard/briefings/card_1',
  // Mid-day UTC on purpose: dueDate is a real timestamp (not the tracker's
  // UTC-midnight date), so a midnight value renders as the previous day in US
  // timezones and would make this fixture's weekday ambiguous.
  dueDate: '2026-09-17T16:00:00.000Z',
  sourceExternalId: 'ext_1',
  sourceItemId: null,
  dismissedAt: null,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
  ...over,
})

const onboardingCard = (
  key: 'meet' | 'priorities',
  status: 'active' | 'complete' = 'active',
): OnboardingCard => ({ key, status }) as OnboardingCard

const loaded = (cards: DashboardCard[]) => ({
  data: cards,
  isPending: false,
  isError: false,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
  window.sessionStorage.clear()
  createMock.mockReset()
  listMessagesMock.mockReset()
  streamMessageMock.mockReset()
  organizationMock.mockReturnValue({ slug: 'eo-asheville', electedOfficeId: 7 })
  cardsMock.mockReturnValue(loaded([]))
  onboardingMock.mockReturnValue({ data: [] })
  prioritiesMock.mockReturnValue({
    data: [{ id: 'p1' }],
    isPending: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChiefOfStaffChatHome', () => {
  it('opens a fresh conversation each session instead of resuming', async () => {
    render(<ChiefOfStaffChatHome />)

    await screen.findByRole('heading', { name: /pick up where you left off/ })
    // Nothing is resolved or created on load: a resumed thread would put months
    // of scroll above the week's cards. The first send mints the conversation.
    expect(createMock).not.toHaveBeenCalled()
    expect(listMessagesMock).not.toHaveBeenCalled()
    // The home IS the chat, so there is no drawer.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the hero with the week ahead', async () => {
    cardsMock.mockReturnValue(loaded([card(), card({ id: 'card_2' })]))
    render(<ChiefOfStaffChatHome />)

    expect(
      await screen.findByRole('heading', {
        name: "Let's pick up where you left off, Renee.",
      }),
    ).toBeInTheDocument()
    // A week out reads as a date: "Thursday" would be ambiguous about which one.
    expect(
      screen.getByText(
        /2 things prioritized this week, the first due September 17/,
      ),
    ).toBeInTheDocument()
  })

  it('names the weekday for a due date inside the coming week', async () => {
    cardsMock.mockReturnValue(
      loaded([card({ dueDate: '2026-09-14T16:00:00.000Z' })]),
    )
    render(<ChiefOfStaffChatHome />)

    expect(
      await screen.findByText(
        /1 thing prioritized this week, the first due Monday/,
      ),
    ).toBeInTheDocument()
  })

  // The support estimate only covers about half of offices, which is why the
  // card home's SupportHero is switched off; the hero must not reintroduce it.
  it('drops the orientation clause when there is nothing prioritized', async () => {
    render(<ChiefOfStaffChatHome />)

    await screen.findByRole('heading', { name: /pick up where you left off/ })
    expect(screen.queryByText(/prioritized this week/)).not.toBeInTheDocument()
    expect(screen.getByText(/I keep your briefings/)).toBeInTheDocument()
  })

  it('renders a dashboard card as a row linking to its own CTA', async () => {
    cardsMock.mockReturnValue(loaded([card()]))
    render(<ChiefOfStaffChatHome />)

    const row = await screen.findByRole('link', {
      name: /Prepare for the Planning Commission meeting/,
    })
    expect(row).toHaveAttribute('href', '/dashboard/briefings/card_1')
    expect(screen.getByText(/housing overlay/)).toBeInTheDocument()
    expect(screen.getByText('Due Thu, Sep 17')).toBeInTheDocument()
  })

  it('suppresses the starter chips while task cards are showing', async () => {
    cardsMock.mockReturnValue(loaded([card()]))
    render(<ChiefOfStaffChatHome />)

    await screen.findByRole('link', { name: /Planning Commission/ })
    // Chips and task cards must never share a turn.
    expect(
      screen.queryByRole('button', { name: /What's most urgent this week/ }),
    ).not.toBeInTheDocument()
  })

  it('falls back to the starter chips when there is nothing to show', async () => {
    render(<ChiefOfStaffChatHome />)

    expect(
      await screen.findByRole('button', {
        name: /What's most urgent this week/,
      }),
    ).toBeInTheDocument()
  })

  it('plays a get-started card opener into a fresh conversation', async () => {
    onboardingMock.mockReturnValue({ data: [onboardingCard('priorities')] })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ChiefOfStaffChatHome />)

    await user.click(
      await screen.findByRole('button', {
        name: /most important issues you're facing/,
      }),
    )

    // The opener is display-only agent copy, so it types in without a model
    // call — no prompt is involved.
    await waitFor(() =>
      expect(
        screen.getByText(/focused on what matters most to you/),
      ).toBeInTheDocument(),
    )
    expect(streamMessageMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  // The card home ends on "you're all caught up", which is a dead end. The
  // rail renders nothing instead and the agent's starter prompts take the turn.
  it('never claims all caught up', async () => {
    render(<ChiefOfStaffChatHome />)

    await screen.findByRole('heading', { name: /pick up where you left off/ })
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-list-empty')).not.toBeInTheDocument()
  })

  describe('first-run', () => {
    // Which step the official is on is derived from their priorities, not
    // stored — the same approach the onboarding-cards service takes.
    it('asks what they are working on when they have no priorities', async () => {
      cardsMock.mockReturnValue(loaded([card()]))
      onboardingMock.mockReturnValue({ data: [onboardingCard('priorities')] })
      prioritiesMock.mockReturnValue({ data: [], isPending: false })
      render(<ChiefOfStaffChatHome />)

      expect(
        await screen.findByTestId('priority-choice-step'),
      ).toBeInTheDocument()
      // Nothing competes with the first question, including the task cards and
      // the get-started card that duplicates it.
      expect(
        screen.queryByRole('link', { name: /Planning Commission/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /What's most urgent this week/ }),
      ).not.toBeInTheDocument()
    })

    it('shows the week once a priority exists', async () => {
      cardsMock.mockReturnValue(loaded([card()]))
      render(<ChiefOfStaffChatHome />)

      await screen.findByRole('link', { name: /Planning Commission/ })
      expect(
        screen.queryByTestId('priority-choice-step'),
      ).not.toBeInTheDocument()
    })

    // An unresolved read must not flash the first question at an official who
    // already answered it.
    it('does not ask while the priorities read is pending', async () => {
      cardsMock.mockReturnValue(loaded([card()]))
      prioritiesMock.mockReturnValue({ data: undefined, isPending: true })
      render(<ChiefOfStaffChatHome />)

      await screen.findByRole('link', { name: /Planning Commission/ })
      expect(
        screen.queryByTestId('priority-choice-step'),
      ).not.toBeInTheDocument()
    })
  })
})
