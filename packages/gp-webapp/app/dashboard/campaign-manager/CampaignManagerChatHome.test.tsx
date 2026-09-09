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

// The seeded greeting is the conversation's sole assistant message, which is
// what makes the body type it in rather than dump it.
const seedGreeting = (): void => {
  createMock.mockResolvedValue({ conversationId: 'conv_1' })
  listMessagesMock.mockResolvedValue([
    {
      id: 'm1',
      conversationId: 'conv_1',
      role: 'assistant',
      content: "Hi Renee, I'm your Campaign Manager.",
      createdAt: '2026-09-09T00:00:00.000Z',
    },
  ])
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'))
  window.localStorage.clear()
  createMock.mockReset()
  listMessagesMock.mockReset()
  streamMessageMock.mockReset()
  campaignMock.mockReturnValue({
    ballotStatus: 'on-the-ballot',
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
  it('opens onto the resumed conversation greeting, with no drawer', async () => {
    seedGreeting()
    render(<CampaignManagerChatHome />)

    await waitFor(() =>
      expect(screen.getByText(/^Hi Renee/)).toBeInTheDocument(),
    )
    // The home IS the chat: it resolves the ongoing conversation itself rather
    // than waiting for a drawer to open.
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(listMessagesMock).toHaveBeenCalledWith('conv_1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the hero with the campaign week and days to election', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
    render(<CampaignManagerChatHome />)

    expect(
      await screen.findByRole('heading', { name: 'Good to see you, Renee.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Week 6, 55 days to election\./),
    ).toBeInTheDocument()
  })

  it('drops an orientation clause whose data has not arrived', async () => {
    seedGreeting()
    campaignMock.mockReturnValue({ ballotStatus: 'on-the-ballot', details: {} })
    render(<CampaignManagerChatHome />)

    await screen.findByRole('heading', { name: /Good to see you/ })
    expect(screen.queryByText(/to election/)).not.toBeInTheDocument()
    expect(screen.getByText(/I keep track of your plan/)).toBeInTheDocument()
  })

  it('renders a tracker task as a card that deep-links into the outreach hub', async () => {
    seedGreeting()
    trackerTasksMock.mockReturnValue({ ...noTasks, tasks: [task()] })
    render(<CampaignManagerChatHome />)

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
    render(<CampaignManagerChatHome />)

    await screen.findByRole('link', { name: /Text 500 likely voters/ })
    // Chips and task cards must never share a turn.
    expect(
      screen.queryByRole('button', { name: /Learn more about the product/ }),
    ).not.toBeInTheDocument()
  })

  it('falls back to the starter chips when there is nothing to recommend', async () => {
    seedGreeting()
    render(<CampaignManagerChatHome />)

    expect(
      await screen.findByRole('button', {
        name: /Learn more about the product/,
      }),
    ).toBeInTheDocument()
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
    render(<CampaignManagerChatHome />)

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
    expect(screen.getByText(/^Hi Renee/)).toBeInTheDocument()
  })
})
