import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CAMPAIGN_MANAGER_START_STORY_SENTINEL } from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import type { ChatStreamEvent } from '../chief-of-staff/data/contracts'
import CampaignManagerChatHome from './CampaignManagerChatHome'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

const campaignMock = vi.fn()
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaignMock()],
}))

const organizationMock = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => organizationMock(),
}))

const updateCampaignMock = vi.fn()
vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: (...args: unknown[]) => updateCampaignMock(...args),
}))

const trackerTasksMock = vi.fn<() => TrackerTasksResult>()
vi.mock(
  '../campaign-plan/components/campaignStrategy/useTrackerTasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../campaign-plan/components/campaignStrategy/useTrackerTasks')
    >()),
    useTrackerTasks: () => trackerTasksMock(),
  }),
)

const storyCompleteMock = vi.fn()
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: () => storyCompleteMock(),
}))

vi.mock('../chief-of-staff/data/use-chat-history', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../chief-of-staff/data/use-chat-history')
  >()),
  useChatHistory: () => ({ data: [] }),
}))

// The compliance surfaces fetch their own TCR record and carry their own Pro
// gate; both have their own tests. Stubbed to testids so these tests assert the
// rail's placement and Pro gating, not their internals.
vi.mock('../components/campaignManager/TextingSetupBanner', () => ({
  default: () => <div data-testid="texting-setup-banner" />,
}))
vi.mock('../components/campaignManager/ProUpgrade3ComplianceCard', () => ({
  default: () => <div data-testid="pro-upgrade-3-compliance-card" />,
}))

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const streamMessageMock = vi.fn()

vi.mock('./campaignManagerChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./campaignManagerChat')>()),
  campaignManagerChatApi: {
    createConversation: (...args: unknown[]) => createMock(...args),
    listMessages: (...args: unknown[]) => listMessagesMock(...args),
    listConversations: vi.fn().mockResolvedValue([]),
    streamMessage: (...args: unknown[]) => streamMessageMock(...args),
    softDelete: vi.fn(),
  },
}))

const makeStream = (
  events: ChatStreamEvent[],
): AsyncIterable<ChatStreamEvent> =>
  (async function* () {
    for (const ev of events) yield ev
  })()

const task = (
  over: Partial<CampaignTrackerTask> = {},
): CampaignTrackerTask => ({
  id: 'task_1',
  title: 'Text 500 likely voters in precinct 04-A',
  description: 'Turnout in 04-A trailed the district by 9 points last cycle.',
  cta: null,
  link: null,
  flowType: 'text',
  week: 6,
  date: '2026-09-17T00:00:00.000Z',
  completed: false,
  phase: null,
  proRequired: null,
  isDefaultTask: false,
  ...over,
})

const noTasks: TrackerTasksResult = {
  tasks: [],
  isPending: false,
  isError: false,
  isGeneratingDynamic: false,
}

// The home starts with no conversation, so a send is what creates one. Tests
// that only need the page rendered call this for the deferred create.
const seedGreeting = (): void => {
  createMock.mockResolvedValue({ conversationId: 'conv_1' })
  listMessagesMock.mockResolvedValue([])
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'))
  window.localStorage.clear()
  window.sessionStorage.clear()
  createMock.mockReset()
  listMessagesMock.mockReset()
  streamMessageMock.mockReset()
  updateCampaignMock.mockReset()
  updateCampaignMock.mockResolvedValue({})
  organizationMock.mockReturnValue({ slug: 'renee-for-council' })
  campaignMock.mockReturnValue({
    ballotStatus: 'on-ballot',
    details: { electionDate: '2026-11-03' },
  })
  trackerTasksMock.mockReturnValue(noTasks)
  storyCompleteMock.mockReturnValue({
    isComplete: true,
    isLoading: false,
    isError: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CampaignManagerChatHome', () => {
  it('opens a fresh conversation each session instead of resuming', async () => {
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    await screen.findByRole('heading', { name: /pick up where you left off/ })
    // Nothing is resolved or created on load: a resumed thread would put months
    // of scroll above the week's cards. The first send mints the conversation.
    expect(createMock).not.toHaveBeenCalled()
    expect(listMessagesMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('continues the same conversation across a remount within the session', async () => {
    window.sessionStorage.setItem(
      'conversational-home:campaign-manager-chat-home:renee-for-council',
      'conv_1',
    )
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        role: 'assistant',
        content: 'Earlier in this sitting.',
        createdAt: '2026-09-09T00:00:00.000Z',
      },
    ])
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    // Navigating away and back must not split one sitting into two threads.
    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith('conv_1'))
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keeps each org on its own conversation', async () => {
    window.sessionStorage.setItem(
      'conversational-home:campaign-manager-chat-home:renee-for-council',
      'conv_council',
    )
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_council',
        role: 'assistant',
        content: 'Council race transcript.',
        createdAt: '2026-09-09T00:00:00.000Z',
      },
    ])
    const { rerender } = render(
      <CampaignManagerChatHome tcrCompliance={null} />,
    )
    await screen.findByText('Council race transcript.')

    organizationMock.mockReturnValue({ slug: 'renee-for-mayor' })
    rerender(<CampaignManagerChatHome tcrCompliance={null} />)

    // The mayor org has no stored conversation, so it starts empty rather than
    // carrying the council race's thread across the switch.
    await waitFor(() =>
      expect(
        screen.queryByText('Council race transcript.'),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows the hero with the campaign week and days to election', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    expect(
      await screen.findByRole('heading', {
        name: "Let's pick up where you left off, Renee.",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Week 6 of your campaign, 55 days to election day\./),
    ).toBeInTheDocument()
  })

  it('drops an orientation clause whose data has not arrived', async () => {
    seedGreeting()
    campaignMock.mockReturnValue({ ballotStatus: 'on-ballot', details: {} })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    await screen.findByRole('heading', { name: /pick up where you left off/ })
    expect(screen.queryByText(/to election/)).not.toBeInTheDocument()
    expect(screen.getByText(/I keep your\s+plan/)).toBeInTheDocument()
  })

  it('renders a tracker task as a card that deep-links into the outreach hub', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    const card = await screen.findByRole('link', {
      name: /Text 500 likely voters in precinct 04-A/,
    })
    // The hub owns the one instance of each channel flow plus its gates, so the
    // CTA links there with the due date bound rather than mounting a flow here.
    expect(card).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=text&source=campaign_manager&due=2026-09-17',
    )
    expect(screen.getByText(/Turnout in 04-A trailed/)).toBeInTheDocument()
    expect(screen.getByText('Due Thu, Sep 17')).toBeInTheDocument()
  })

  it('suppresses the starter chips while task cards are showing', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    await screen.findByRole('link', { name: /Text 500 likely voters/ })
    // Chips and task cards must never share a turn.
    expect(
      screen.queryByRole('button', { name: /Learn more about the product/ }),
    ).not.toBeInTheDocument()
  })

  it('falls back to the starter chips when there is nothing to recommend', async () => {
    seedGreeting()
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    expect(
      await screen.findByRole('button', {
        name: /Learn more about the product/,
      }),
    ).toBeInTheDocument()
  })

  describe('10DLC compliance', () => {
    // Compliance is a middle step: it arrives once the candidate has done the
    // intro and setup, so it never competes with getting on the ballot.
    it('rides along for a Pro candidate once onboarding is clear', async () => {
      seedGreeting()
      campaignMock.mockReturnValue({
        isPro: true,
        ballotStatus: 'on-ballot',
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByTestId('pro-upgrade-3-compliance-card'),
      ).toBeInTheDocument()
      expect(screen.getByTestId('texting-setup-banner')).toBeInTheDocument()
    })

    it('holds compliance back while an onboarding card is still pending', async () => {
      seedGreeting()
      campaignMock.mockReturnValue({
        isPro: true,
        ballotStatus: 'qualified-not-filed',
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      await screen.findByRole('button', { name: /get you on the ballot/ })
      expect(
        screen.queryByTestId('pro-upgrade-3-compliance-card'),
      ).not.toBeInTheDocument()
    })

    // A non-Pro candidate gets no Pro surface on this home at all, upsell
    // included, so the conversation never recommends something they cannot act
    // on.
    it('shows no Pro surface at all to a non-Pro candidate', async () => {
      seedGreeting()
      campaignMock.mockReturnValue({
        isPro: false,
        ballotStatus: 'on-ballot',
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      await screen.findByRole('heading', { name: /pick up where you left off/ })
      expect(
        screen.queryByTestId('pro-upgrade-3-compliance-card'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId('texting-setup-banner'),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/Get Pro/)).not.toBeInTheDocument()
    })
  })

  // Regeneration is a weekly server-side run and the client cannot ask for more
  // tasks, so a cleared week can hold for days. Spend the room on the channels
  // that scale by effort, plus a review of the outreach already done.
  it('offers doors, an event and an outreach review when the week is clear', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({
      ...noTasks,
      tasks: [task({ completed: true })],
    })
    campaignMock.mockReturnValue({
      isPro: true,
      ballotStatus: 'on-ballot',
      details: { electionDate: '2026-11-03' },
    })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    expect(
      await screen.findByText(
        /You are clear on everything I set for this week/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Knock another turf this week/ }),
    ).toHaveAttribute('href', '/dashboard/door-knocking')
    expect(
      screen.getByRole('button', { name: /Put an event on the calendar/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Go deeper on the voters you reached/,
      }),
    ).toBeInTheDocument()
  })

  it('does not claim a clear week before any tasks have generated', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({
      ...noTasks,
      tasks: [task({ isDefaultTask: true })],
      isGeneratingDynamic: true,
    })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    expect(
      await screen.findByText(/still putting this week's tasks together/),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/You are clear on everything/),
    ).not.toBeInTheDocument()
  })

  describe('filing deadline', () => {
    const notFiledPastDeadline = {
      isPro: false,
      ballotStatus: 'qualified-not-filed',
      details: {
        electionDate: '2026-11-03',
        filingPeriodsEnd: '2026-08-01',
      },
    }

    it('stops telling a candidate to file after their window closed', async () => {
      seedGreeting()
      campaignMock.mockReturnValue(notFiledPastDeadline)
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByText(/Your filing deadline has passed/),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /get you on the ballot/ }),
      ).not.toBeInTheDocument()
    })

    it('still prompts to file while the window is open', async () => {
      seedGreeting()
      campaignMock.mockReturnValue({
        ...notFiledPastDeadline,
        details: {
          electionDate: '2026-11-03',
          filingPeriodsEnd: '2026-10-01',
        },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByRole('button', { name: /get you on the ballot/ }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Your filing deadline has passed/),
      ).not.toBeInTheDocument()
    })

    // An unknown window must not read as closed, or a candidate whose race
    // never resolved dates gets asked about a ballot nobody told them about.
    it('does not ask when the race has no filing dates', async () => {
      seedGreeting()
      campaignMock.mockReturnValue({
        ...notFiledPastDeadline,
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByRole('button', { name: /get you on the ballot/ }),
      ).toBeInTheDocument()
    })

    // A candidate who filed on time is past their own filing deadline for most
    // of the campaign, so the question must not fire for them.
    it('leaves an on-ballot candidate alone past the deadline', async () => {
      seedGreeting()
      trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
      campaignMock.mockReturnValue({
        isPro: true,
        ballotStatus: 'on-ballot',
        details: {
          electionDate: '2026-11-03',
          filingPeriodsEnd: '2026-08-01',
        },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByRole('link', { name: /Text 500 likely voters/ }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Your filing deadline has passed/),
      ).not.toBeInTheDocument()
    })

    it('persists the ballot status when they say they made it', async () => {
      seedGreeting()
      campaignMock.mockReturnValue(notFiledPastDeadline)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      await user.click(
        await screen.findByRole('button', { name: 'Yes, I made the ballot' }),
      )

      // Written to the column, not remembered locally, so every other surface
      // that reads ballotStatus is fixed too.
      await waitFor(() =>
        expect(updateCampaignMock).toHaveBeenCalledWith([
          { key: 'ballotStatus', value: 'on-ballot' },
        ]),
      )
    })

    it('hands a missed ballot to the manager and stops asking', async () => {
      seedGreeting()
      campaignMock.mockReturnValue(notFiledPastDeadline)
      streamMessageMock.mockReturnValue(
        makeStream([
          {
            type: 'text',
            delta: 'There is a next cycle, and we will be here.',
          },
          { type: 'done' },
        ]),
      )
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      await user.click(
        await screen.findByRole('button', {
          name: 'No, I did not file in time',
        }),
      )

      // The supportive close is the manager's reply, so the answer opens a turn
      // rather than rendering canned card copy.
      await waitFor(() =>
        expect(streamMessageMock).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('did not make it onto the ballot'),
          }),
        ),
      )
      expect(updateCampaignMock).not.toHaveBeenCalled()
      expect(
        screen.queryByText(/Your filing deadline has passed/),
      ).not.toBeInTheDocument()
    })
  })

  describe('free tier', () => {
    // A Pro-only task CTA is a wall for a free candidate, and in a conversation
    // a wall reads as the manager not knowing what they have access to.
    it('drops Pro-only tasks rather than offering a wall', async () => {
      seedGreeting()
      trackerTasksMock.mockReturnValue({
        ...noTasks,
        tasks: [
          task({ id: 'pro', title: 'Send an intro text', proRequired: true }),
          task({
            id: 'free',
            title: 'Post a district update',
            flowType: 'socialMedia',
            proRequired: false,
          }),
        ],
      })
      campaignMock.mockReturnValue({
        isPro: false,
        ballotStatus: 'on-ballot',
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      expect(
        await screen.findByRole('link', { name: /Post a district update/ }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Send an intro text/)).not.toBeInTheDocument()
    })

    it('does not push door knocking to a free candidate on a clear week', async () => {
      seedGreeting()
      trackerTasksMock.mockReturnValue({
        ...noTasks,
        tasks: [task({ completed: true, proRequired: false })],
      })
      campaignMock.mockReturnValue({
        isPro: false,
        ballotStatus: 'on-ballot',
        details: { electionDate: '2026-11-03' },
      })
      render(<CampaignManagerChatHome tcrCompliance={null} />)

      // Events are open to everyone; doors and the outreach review are Pro.
      expect(
        await screen.findByRole('button', {
          name: /Put an event on the calendar/,
        }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /Knock another turf/ }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Go deeper on the voters/ }),
      ).not.toBeInTheDocument()
    })
  })

  it('fires the story kickoff into the conversation without a user bubble', async () => {
    seedGreeting()
    storyCompleteMock.mockReturnValue({
      isComplete: false,
      isLoading: false,
      isError: false,
    })
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me about why you are running.' },
        { type: 'done' },
      ]),
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<CampaignManagerChatHome tcrCompliance={null} />)

    await user.click(
      await screen.findByRole('button', {
        name: /Tell me why you are running/,
      }),
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv_1',
          content: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
        }),
      ),
    )
    // The sentinel is sent hidden, so the candidate never sees the prompt that
    // triggered the flow — and the greeting they already read stays put.
    expect(
      screen.queryByText(CAMPAIGN_MANAGER_START_STORY_SENTINEL),
    ).not.toBeInTheDocument()
  })
})
