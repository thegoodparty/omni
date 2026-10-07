import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import type { ChatStreamEvent } from '../chief-of-staff/data/contracts'
import type ChiefOfStaffChatSurfaceComponent from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import { buildCampaignManagerIntro } from './campaignManagerChat'
import CampaignManagerHome from './CampaignManagerHome'
import { FIRST_LANDING_HEADLINE, HOME_HEADLINES } from './homeHeadlines'
import { CampaignManagerChatProvider } from './CampaignManagerChatProvider'

type SurfaceProps = React.ComponentProps<
  typeof ChiefOfStaffChatSurfaceComponent
>

// The chat dock (footer + surface + open/story controls) lives in the
// always-present CampaignManagerChatProvider (mounted in DashboardLayout in
// production); the home reads it from context. Render the same composition here
// so the card (home) and the footer/surface (provider) wire up as they do in
// the app.
const renderHome = () =>
  render(
    <CampaignManagerChatProvider>
      <CampaignManagerHome tcrCompliance={null} />
    </CampaignManagerChatProvider>,
  )

// firstName now comes from useUser (read by the provider), not a prop.
// This suite renders the real ChiefOfStaffChatBody, which reads the org slug
// to scope the saved-list cache invalidation. In the app every chat sits under
// PageWrapper's OrganizationProvider; the harness has to supply it.
// The chat body's outreach flows report a failed save through the snackbar,
// and this suite renders no provider (the app shell's PageWrapper does).
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'test-org' }),
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))

// The `personalize=1` deep link (from the plan-tab story gate) drives the
// provider's URL-reading effect. It reads window.location directly (not
// useSearchParams), so tests set the URL via history; useRouter().replace is
// mocked to observe the param being cleared.
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(window.location.search),
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

let mockTasks: CampaignTrackerTask[] = []
const mockToggleMutate = vi.fn()
const mockSetAside = vi.fn()

const doorsTask: CampaignTrackerTask = {
  id: 'doors-1',
  title: 'Knock on Doors',
  description: 'Knock your target doors to connect with voters face-to-face.',
  cta: null,
  link: null,
  flowType: 'doorKnocking',
  week: 1,
  date: '2026-10-09T00:00:00.000Z',
  completed: false,
  phase: 'active',
  proRequired: true,
  isDefaultTask: false,
}

vi.mock(
  '../campaign-plan/components/campaignStrategy/useTrackerTasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../campaign-plan/components/campaignStrategy/useTrackerTasks')
    >()),
    useTrackerTasks: (): TrackerTasksResult => ({
      tasks: mockTasks,
      isPending: false,
      isError: false,
      isGeneratingDynamic: false,
    }),
    useToggleTrackerTaskComplete: () => ({
      mutate: mockToggleMutate,
      isPending: false,
    }),
    useSetTrackerTaskAside: () => ({ mutate: mockSetAside, isPending: false }),
  }),
)

// The Pro banner + progress section are the legacy dashboard widgets (their own
// campaign/voter-contact providers); this smoke test only covers the home's
// composition, so stub them out.
vi.mock('../components/campaignManager/ProUpgradeBanner', () => ({
  default: () => null,
}))
// Echo the prop so the composition test can assert the home passes the
// server-fetched record through (the banner's own gating has its own tests).
vi.mock('../components/campaignManager/TextingSetupBanner', () => ({
  default: ({
    tcrCompliance,
  }: {
    tcrCompliance: { status: string } | null
  }) => (
    <div
      data-testid="texting-setup-banner"
      data-tcr-status={tcrCompliance?.status ?? 'none'}
    />
  ),
}))
// Rendered rather than nulled out: the composition test below is the guard
// against this card going missing again, and its own Pro gating / status
// branching is covered in ProUpgrade3ComplianceCard.test.tsx.
vi.mock('../components/campaignManager/ProUpgrade3ComplianceCard', () => ({
  default: () => <div data-testid="pro-upgrade-3-compliance-card" />,
}))
vi.mock('../components/campaignManager/ProgressSection', () => ({
  default: () => null,
}))

// No prior conversations. Partial-mock so the footer's history popover keeps
// its real useDeleteConversation.
vi.mock('../chief-of-staff/data/use-chat-history', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../chief-of-staff/data/use-chat-history')
  >()),
  useChatHistory: () => ({ data: [] }),
}))

// An incomplete story, so the manager still offers to personalize.
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
  window.history.replaceState({}, '', '/dashboard')
  createMock.mockReset()
  listMessagesMock.mockReset()
  streamMessageMock.mockReset()
  mockRouterReplace.mockReset()
  surfacePropsMock.mockClear()
  mockTasks = []
  mockToggleMutate.mockReset()
  mockSetAside.mockReset()
})

// Opens the manager chat onto its seeded greeting: opening the footer chat
// resolves the conversation, and listMessages returns the
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
  renderHome()
  await user.click(
    screen.getByRole('button', { name: /open campaign manager chat/i }),
  )
  await waitFor(() => expect(screen.getByText(/^Hi Renee/)).toBeInTheDocument())
}

describe('CampaignManagerHome', () => {
  it('renders the tasks surface and campaign-manager chat entries', () => {
    renderHome()

    // The card is only ever a plan task, never one of the manager's prompts.
    expect(
      screen.queryByRole('button', { name: 'Personalize your campaign' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Meet your virtual Campaign Manager'),
    ).not.toBeInTheDocument()
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

  it('renders the quick-prompt pills and personalized composer placeholder', async () => {
    await openOnSeededGreeting()

    expect(
      screen.getByRole('button', { name: 'What should I focus on to win?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Which voters should I reach this week?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Hi Renee, how can I help?'),
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
  it('starts the story flow (opens + hidden sentinel kickoff) from the deep link', async () => {
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )
    window.history.replaceState({}, '', '/dashboard?personalize=1')
    renderHome()

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
    window.history.replaceState({}, '', '/dashboard?personalize=1')
    renderHome()

    // The story-intake reply streams in.
    await waitFor(() =>
      expect(screen.getByText(/Before I build your plan/)).toBeInTheDocument(),
    )
    // The seeded general greeting is hidden, so the manager never double-greets.
    expect(
      screen.queryByText(/I'm your Campaign Manager\./),
    ).not.toBeInTheDocument()
  })

  it('opens the manager without a kickoff from the footer chat', async () => {
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
    window.history.replaceState({}, '', '/dashboard?personalize=1')
    renderHome()
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
    window.history.replaceState({}, '', '/dashboard?personalize=1')
    createMock.mockResolvedValue({ conversationId: 'conv_1' })
    listMessagesMock.mockResolvedValue([])
    streamMessageMock.mockReturnValue(
      makeStream([
        { type: 'text', delta: 'Tell me your why.' },
        { type: 'done', assistantMessageId: 'a1' },
      ]),
    )

    const { rerender } = renderHome()

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
    rerender(
      <CampaignManagerChatProvider>
        <CampaignManagerHome tcrCompliance={null} />
      </CampaignManagerChatProvider>,
    )
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(streamMessageMock).toHaveBeenCalledTimes(1)
  })

  it('renders the texting-setup banner with the server-fetched record (ENG-10858)', () => {
    renderHome()

    // The story-cohort home must include the banner (the legacy CampaignManager
    // home renders it too); tcrCompliance={null} flows through untouched.
    expect(screen.getByTestId('texting-setup-banner')).toHaveAttribute(
      'data-tcr-status',
      'none',
    )
  })

  it('does not auto-launch the story flow without the personalize deep link', () => {
    renderHome()

    expect(createMock).not.toHaveBeenCalled()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

describe('CampaignManagerHome headline', () => {
  it('heads the card with a line for its kind of task', async () => {
    mockTasks = [doorsTask]
    renderHome()

    const heading = await screen.findByRole('heading', { level: 2 })
    expect(HOME_HEADLINES.doorKnocking).toContain(heading.textContent)
  })

  it('greets the first landing after onboarding once, then strips the marker', async () => {
    mockTasks = [doorsTask]
    window.history.replaceState({}, '', '/dashboard?welcome=1')
    renderHome()

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: FIRST_LANDING_HEADLINE,
      }),
    ).toBeInTheDocument()
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard', {
      scroll: false,
    })
  })
})

describe('CampaignManagerHome with no next task', () => {
  // A Thursday: this week runs Oct 5-11, next week starts Oct 12.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    return () => vi.useRealTimers()
  })

  // The week's AI-picked tasks, which carry their own dates.
  const activeTask = (
    over: Partial<CampaignTrackerTask>,
  ): CampaignTrackerTask => ({
    ...doorsTask,
    isDefaultTask: false,
    ...over,
  })

  it('celebrates a finished week and pulls next week forward on request', async () => {
    mockTasks = [
      activeTask({
        id: 'done',
        date: '2026-10-06T00:00:00.000Z',
        completed: true,
      }),
      activeTask({
        id: 'ahead',
        title: 'Make phone bank calls',
        flowType: 'phoneBanking',
        date: '2026-10-13T00:00:00.000Z',
      }),
    ]
    const user = userEvent.setup()
    renderHome()

    expect(
      await screen.findByText('You finished this week’s tasks'),
    ).toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 2 })
    expect(HOME_HEADLINES.weekDone).toContain(heading.textContent)

    await user.click(screen.getByRole('button', { name: 'Get a head start' }))

    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: 'Make phone bank calls',
      }),
    ).toBeInTheDocument()
    expect(HOME_HEADLINES.phoneBanking).toContain(
      screen.getByRole('heading', { level: 2 }).textContent,
    )
  })

  it('says nothing is due, without celebrating, in a week with no tasks', async () => {
    mockTasks = [activeTask({ id: 'later', date: '2026-10-27T00:00:00.000Z' })]
    renderHome()

    expect(await screen.findByText('Nothing due this week')).toBeInTheDocument()
    expect(screen.getByText('Check back next week.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Get a head start' }),
    ).not.toBeInTheDocument()
    expect(HOME_HEADLINES.caughtUp).toContain(
      screen.getByRole('heading', { level: 2 }).textContent,
    )
  })
})

describe('CampaignManagerHome marking a task done', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    return () => vi.useRealTimers()
  })

  const setupTask = (
    over: Partial<CampaignTrackerTask>,
  ): CampaignTrackerTask => ({
    ...doorsTask,
    flowType: null,
    phase: 'preLaunch',
    isDefaultTask: true,
    proRequired: false,
    ...over,
  })

  it('stacks the plan’s next tasks behind the front card', async () => {
    mockTasks = [
      setupTask({ id: 'ein', title: 'Get your EIN', date: '2026-10-09' }),
      setupTask({
        id: 'bank',
        title: 'Open a campaign bank account',
        date: '2026-10-10',
      }),
    ]
    renderHome()

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Get your EIN' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
  })

  it('completes on the first press, without asking to confirm', async () => {
    mockTasks = [
      setupTask({ id: 'ein', title: 'Get your EIN', date: '2026-10-09' }),
    ]
    const user = userEvent.setup()
    renderHome()

    await user.click(
      await screen.findByRole('button', { name: 'Mark as done' }),
    )

    expect(mockToggleMutate).toHaveBeenCalledWith({
      id: 'ein',
      completed: true,
    })
    expect(screen.queryByText('Mark this task done?')).not.toBeInTheDocument()
  })
})

describe('CampaignManagerHome skipping a task', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    return () => vi.useRealTimers()
  })

  const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
    ...doorsTask,
    flowType: null,
    phase: 'preLaunch',
    isDefaultTask: true,
    proRequired: false,
    date: '2026-10-30T00:00:00.000Z',
    ...over,
  })

  it('offers to put it off or drop it, and saves the choice', async () => {
    mockTasks = [task({ id: 'ein', title: 'Get your EIN' })]
    const user = userEvent.setup()
    renderHome()

    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('menuitem', { name: 'Don’t suggest it again' }),
    )

    expect(mockSetAside).toHaveBeenCalledWith({
      id: 'ein',
      reason: 'notForMe',
    })
  })

  it('only lets a required task be put off', async () => {
    mockTasks = [
      task({
        id: 'sigs',
        title: 'Submit your Ballot Access Signatures',
        date: '2026-10-10T00:00:00.000Z',
      }),
    ]
    const user = userEvent.setup()
    renderHome()

    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    // Its date is the state's deadline, which we don't know, so the
    // snooze isn't capped to it.
    expect(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Don’t suggest it again' }),
    ).not.toBeInTheDocument()
  })

  it('puts a task off no later than its real due date', async () => {
    mockTasks = [
      task({
        id: 'ein',
        title: 'Get your EIN',
        date: '2026-10-10T00:00:00.000Z',
      }),
    ]
    const user = userEvent.setup()
    renderHome()

    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Show on Oct 10' }),
    ).toBeInTheDocument()
  })
})
