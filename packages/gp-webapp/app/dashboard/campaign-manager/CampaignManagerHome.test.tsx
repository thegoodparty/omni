import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import type { ChatStreamEvent } from '../chief-of-staff/data/contracts'
import type ChiefOfStaffChatSurfaceComponent from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import { buildCampaignManagerIntro } from './campaignManagerChat'
import CampaignManagerHome from './CampaignManagerHome'

type SurfaceProps = React.ComponentProps<
  typeof ChiefOfStaffChatSurfaceComponent
>

// The `personalize=1` deep link (from the plan-tab story gate) drives this
// home's own useSearchParams/useRouter effect, so this file supplies its own
// mock (overriding vitest.setup.ts's bare useRouter/usePathname one), same
// pattern as OutreachComposeDeepLink.test.tsx.
let mockSearchParams = new URLSearchParams()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  usePathname: () => '/dashboard',
  useSearchParams: () => mockSearchParams,
}))

const surfacePropsMock = vi.fn<(props: SurfaceProps) => void>()

// Wrap the real surface so the pendingKickoff-lifecycle tests can assert on
// the prop it receives directly, while every other test in this file still
// exercises the real chat body underneath (unchanged rendering/behavior).
vi.mock(
  '../chief-of-staff/components/chat/ChiefOfStaffChatSurface',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../chief-of-staff/components/chat/ChiefOfStaffChatSurface')
      >()
    return {
      ...actual,
      default: (props: SurfaceProps) => {
        surfacePropsMock(props)
        return <actual.default {...props} />
      },
    }
  },
)

const latestSurfaceProps = (): SurfaceProps => {
  const call = surfacePropsMock.mock.calls.at(-1)
  if (!call) throw new Error('ChiefOfStaffChatSurface never rendered')
  return call[0]
}

vi.mock(
  '../campaign-plan/components/campaignStrategy/useTrackerTasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../campaign-plan/components/campaignStrategy/useTrackerTasks')
    >()),
    useTrackerTasks: (): TrackerTasksResult => ({
      tasks: [],
      isPending: false,
      isError: false,
      isGeneratingDynamic: false,
    }),
    useToggleTrackerTaskComplete: () => ({ mutate: vi.fn(), isPending: false }),
  }),
)

// The Pro banner + progress section are the legacy dashboard widgets (their own
// campaign/voter-contact providers); this smoke test only covers the home's
// composition, so stub them out.
vi.mock('../components/campaignManager/ProUpgradeBanner', () => ({
  default: () => null,
}))
vi.mock('../components/campaignManager/ProgressSection', () => ({
  default: () => null,
}))

// No prior conversations, so the first-run "meet" card renders. Partial-mock so
// the footer's history popover keeps its real useDeleteConversation.
vi.mock('../chief-of-staff/data/use-chat-history', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../chief-of-staff/data/use-chat-history')
  >()),
  useChatHistory: () => ({ data: [] }),
}))

// The story card transitively renders here too; default to an incomplete
// story so both first-run cards are present for this smoke test.
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: vi.fn(() => ({
    isComplete: false,
    isLoading: false,
    isError: false,
  })),
}))

const createMock = vi.fn()
const listMessagesMock = vi.fn()
const streamMessageMock = vi.fn()

// The manager's own chat client. Mocked here (rather than the shared factory)
// so createConversation/listMessages/streamMessage are controllable per test
// while buildCampaignManagerIntro/CAMPAIGN_MANAGER_HISTORY_KEY stay real.
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

function makeStream(events: ChatStreamEvent[]): AsyncIterable<ChatStreamEvent> {
  return (async function* () {
    for (const ev of events) yield ev
  })()
}

beforeEach(() => {
  window.localStorage.clear()
  createMock.mockReset()
  listMessagesMock.mockReset()
  streamMessageMock.mockReset()
  mockSearchParams = new URLSearchParams()
  mockRouterReplace.mockReset()
  surfacePropsMock.mockClear()
})

// Opens the manager chat onto its seeded greeting: clicking "meet your
// campaign manager" resolves the conversation, and listMessages returns the
// server-seeded greeting as the sole assistant message (played back, then
// committed to history).
async function openOnSeededGreeting(): Promise<void> {
  createMock.mockResolvedValue({ conversationId: 'conv_1' })
  listMessagesMock.mockResolvedValue([
    {
      id: 'm1',
      conversationId: 'conv_1',
      role: 'assistant',
      content: "Hi Renee, I'm your Campaign Manager.",
      createdAt: '2026-07-16T00:00:00.000Z',
    },
  ])

  const user = userEvent.setup()
  render(<CampaignManagerHome firstName="Renee" />)
  await user.click(
    screen.getByRole('button', { name: /meet your campaign manager/i }),
  )
  await waitFor(() => expect(screen.getByText(/^Hi Renee/)).toBeInTheDocument())
}

describe('CampaignManagerHome', () => {
  it('renders the tasks surface and campaign-manager chat entries', () => {
    render(<CampaignManagerHome firstName="Renee" />)

    expect(
      screen.getByRole('button', { name: /meet your campaign manager/i }),
    ).toBeInTheDocument()
    // The footer chat bar uses the campaign-manager open label, not CoS.
    expect(
      screen.getByRole('button', { name: /open campaign manager chat/i }),
    ).toBeInTheDocument()
    // Nothing Chief-of-Staff-branded leaks into the campaign-manager surface.
    expect(screen.queryByText(/chief of staff/i)).not.toBeInTheDocument()
  })

  it('renders the three suggestion chips alongside the seeded greeting', async () => {
    await openOnSeededGreeting()

    expect(
      screen.getByRole('button', { name: /personalize your campaign/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Tell me about why you're running, and we'll help you draft your " +
          'voter outreach plan.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /learn more about the product/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Get a quick tour of the product and its features.'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /ask me about something else/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Type any question in the box below.'),
    ).toBeInTheDocument()
  })

  it('hidden-sends the story sentinel when "Personalize your campaign" is clicked', async () => {
    await openOnSeededGreeting()
    const user = userEvent.setup()
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    await user.click(
      screen.getByRole('button', { name: /personalize your campaign/i }),
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
        }),
      ),
    )
    // The kickoff prompt is hidden, no user bubble shows the sentinel text.
    expect(
      screen.queryByText(CAMPAIGN_MANAGER_START_STORY_SENTINEL),
    ).not.toBeInTheDocument()
  })

  it('hidden-sends the product-overview sentinel when "Learn more about the product" is clicked', async () => {
    await openOnSeededGreeting()
    const user = userEvent.setup()
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Here is a quick tour.' },
        { type: 'done', assistantMessageId: 'a2' },
      ]),
    )

    await user.click(
      screen.getByRole('button', { name: /learn more about the product/i }),
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
        }),
      ),
    )
    expect(
      screen.queryByText(CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL),
    ).not.toBeInTheDocument()
  })

  it('focuses the composer when "Ask me about something else" is clicked', async () => {
    await openOnSeededGreeting()
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: /ask me about something else/i }),
    )

    expect(screen.getByLabelText(/ask a question/i)).toHaveFocus()
    expect(streamMessageMock).not.toHaveBeenCalled()
  })
})

describe('CampaignManagerHome story auto-launch', () => {
  it('starts the story flow (opens + hidden sentinel kickoff) when the story card is clicked', async () => {
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignManagerHome firstName="Renee" />)

    await user.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
        }),
      ),
    )
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(latestSurfaceProps().pendingKickoff).toBe(
      CAMPAIGN_MANAGER_START_STORY_SENTINEL,
    )
  })

  it('suppresses the seeded general greeting on the story entry so only the story flow shows', async () => {
    // The server seeds the general greeting as the conversation's first
    // message; the story kickoff then streams the intake greeting. Without
    // suppression both render (the reported double greeting).
    const generalGreeting = buildCampaignManagerIntro('Renee').join('\n\n')
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        conversationId: 'conv_1',
        role: 'assistant',
        content: generalGreeting,
        createdAt: '2026-07-16T00:00:00.000Z',
      },
    ])
    streamMessageMock.mockReturnValue(
      makeStream([
        {
          type: 'text',
          delta: "Before I build your plan, let's get your story.",
        },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignManagerHome firstName="Renee" />)

    await user.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )

    // The story-intake reply streams in.
    await waitFor(() =>
      expect(screen.getByText(/Before I build your plan/)).toBeInTheDocument(),
    )
    // The seeded general greeting is hidden, so the manager never double-greets.
    expect(
      screen.queryByText(/I'm your Campaign Manager\./),
    ).not.toBeInTheDocument()
  })

  it('opens the manager without a kickoff via the meet card', async () => {
    await openOnSeededGreeting()

    expect(latestSurfaceProps().open).toBe(true)
    expect(latestSurfaceProps().pendingKickoff).toBeUndefined()
    expect(streamMessageMock).not.toHaveBeenCalled()
  })

  it('clears pendingKickoff when the chat closes', async () => {
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignManagerHome firstName="Renee" />)

    await user.click(
      screen.getByRole('button', { name: 'Personalize your campaign' }),
    )
    await waitFor(() =>
      expect(latestSurfaceProps().pendingKickoff).toBe(
        CAMPAIGN_MANAGER_START_STORY_SENTINEL,
      ),
    )

    act(() => {
      latestSurfaceProps().onOpenChange(false)
    })

    await waitFor(() => expect(latestSurfaceProps().open).toBe(false))
    expect(latestSurfaceProps().pendingKickoff).toBeUndefined()
  })

  it('fires the story kickoff once from the personalize=1 deep link, then clears the param', async () => {
    mockSearchParams = new URLSearchParams('personalize=1')
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    const { rerender } = render(<CampaignManagerHome firstName="Renee" />)

    await waitFor(() =>
      expect(streamMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
        }),
      ),
    )
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard')

    // A later re-render (e.g. a sibling state update) must not refire it.
    rerender(<CampaignManagerHome firstName="Renee" />)
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-launch the story flow without the personalize deep link', () => {
    render(<CampaignManagerHome firstName="Renee" />)

    expect(createMock).not.toHaveBeenCalled()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})
