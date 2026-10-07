import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS } from 'helpers/analyticsHelper'
import type { TrackerTasksResult } from './useTrackerTasks'
import CampaignStrategySection from './CampaignStrategySection'

const mockTasks = vi.fn<() => TrackerTasksResult>()
const mockToggle = vi.fn()
const mockGenerate = vi.fn()
let mockIsGenerating = false
let mockIsProd = false
// Keep the real isVoterContactFlowType; stub only the data + mutation hooks.
vi.mock('./useTrackerTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTrackerTasks')>()),
  useTrackerTasks: () => mockTasks(),
  useToggleTrackerTaskComplete: () => ({
    mutate: mockToggle,
    isPending: false,
  }),
  useGenerateTrackerTasks: () => ({
    generate: mockGenerate,
    isGenerating: mockIsGenerating,
  }),
}))
vi.mock('appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('appEnv')>()),
  get IS_PROD() {
    return mockIsProd
  },
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 55, details: {}, electionDate: null }],
}))
const mockTrackEvent = vi.fn()
const mockSuccessSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: mockSuccessSnackbar,
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
// Stub the count modal to a submit button, mirroring the manager test.
vi.mock('../../../components/tasks/CountModal', () => ({
  default: ({
    flowType,
    onSubmit,
  }: {
    flowType: string
    onSubmit: (count: number) => void
  }) => (
    <div>
      <span>count-modal:{flowType}</span>
      <button type="button" onClick={() => onSubmit(7)}>
        submit-count
      </button>
    </div>
  ),
}))

const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: 'task-1',
  title: 'A task',
  description: '',
  cta: null,
  link: null,
  flowType: null,
  week: 2,
  // Far future so its phase is the current ("active") one.
  date: '2099-11-03T00:00:00.000Z',
  completed: false,
  phase: 'launch',
  proRequired: false,
  isDefaultTask: false,
  ...over,
})

// A done row's undo lives in its "More options" menu; the next task, which
// these tests complete, shows Mark as done as a button.
const chooseFromMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  item: string,
) => {
  await user.click(screen.getByRole('button', { name: 'More options' }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

// The phase in focus opens on its own; open Launch only if it is closed, so
// the helper never toggles an open phase shut.
const openLaunch = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button', { name: /^Launch/ })
  if (trigger.getAttribute('aria-expanded') !== 'true')
    await user.click(trigger)
}

const settled = (tasks: CampaignTrackerTask[]): TrackerTasksResult => ({
  tasks,
  isPending: false,
  isError: false,
  isGeneratingDynamic: false,
})

beforeEach(() => {
  mockToggle.mockClear()
  mockGenerate.mockClear()
  mockTrackEvent.mockClear()
  mockIsGenerating = false
  mockIsProd = false
})

describe('CampaignStrategySection — completing tasks', () => {
  it('records a voter-contact count when completing an outreach task', async () => {
    mockTasks.mockReturnValue(
      settled([task({ id: 't1', title: 'Greet voters', flowType: 'events' })]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)
    await openLaunch(user)

    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(mockToggle).not.toHaveBeenCalled()
    expect(screen.getByText('count-modal:events')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit-count' }))
    expect(mockToggle).toHaveBeenCalledWith({
      id: 't1',
      completed: true,
      type: 'events',
      quantity: 7,
    })
  })

  // Task completion is the primary activation metric and fired from nowhere
  // between the legacy checklist's deletion and this change. `trackerTaskId`
  // is what joins a completed task to the outreach it produced.
  it('reports a completed task, and the outreach an outreach task logged', async () => {
    mockTasks.mockReturnValue(
      settled([
        task({
          id: 't1',
          title: 'Host a meet-and-greet',
          flowType: 'events',
        }),
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)
    await openLaunch(user)

    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    // Still pending the count, so nothing is reported yet — the candidate can
    // still cancel out of the modal.
    expect(
      mockTrackEvent.mock.calls.filter(
        ([name]) => name === EVENTS.Dashboard.CampaignPlan.TaskCompleted,
      ),
    ).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'submit-count' }))
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.TaskCompleted,
      { trackerTaskId: 't1', medium: 'event', phase: 'launch' },
    )
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.VoterContact.CampaignCompleted,
      expect.objectContaining({
        medium: 'event',
        fanout: 'one-to-many',
        product: 'win',
        recipientCount: 7,
        trackerTaskId: 't1',
        phase: 'launch',
        method: 'manual',
      }),
    )
    // Nothing here captures a cost, so no price is claimed.
    const completed = mockTrackEvent.mock.calls.find(
      ([name]) => name === EVENTS.Dashboard.VoterContact.CampaignCompleted,
    )
    expect(completed?.[1]).not.toHaveProperty('price')
  })

  // Offline work the product can't see (here a community event), so it is
  // still completed by hand. Door knocking used to stand in here; it now
  // closes itself through its own screen and offers no manual toggle.
  // Un-completing is a correction, not an activation signal, so an event
  // named Completed must stay silent on it.
  it('stays silent when a task is un-completed', async () => {
    mockTasks.mockReturnValue(
      settled([
        task({
          id: 't3',
          title: 'Host a meet-and-greet',
          flowType: 'events',
          completed: true,
        }),
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)
    await openLaunch(user)

    await chooseFromMenu(user, 'Mark as not done')
    expect(mockToggle).toHaveBeenCalledWith({ id: 't3', completed: false })
    expect(
      mockTrackEvent.mock.calls.filter(
        ([name]) => name === EVENTS.Dashboard.CampaignPlan.TaskCompleted,
      ),
    ).toHaveLength(0)
    expect(screen.queryByText(/count-modal/)).not.toBeInTheDocument()
  })

  it('completes a non-outreach task directly, without a count', async () => {
    mockTasks.mockReturnValue(
      settled([
        task({ id: 't2', title: 'Get Meta verified', flowType: 'awareness' }),
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)
    await openLaunch(user)

    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(mockToggle).toHaveBeenCalledWith({ id: 't2', completed: true })
    expect(screen.queryByText(/count-modal/)).not.toBeInTheDocument()
  })
})

describe('CampaignStrategySection — tasks arriving in the background', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockSuccessSnackbar.mockClear()
  })

  it('shows what it has, with nothing to wait on, while more are on the way', () => {
    mockTasks.mockReturnValue(
      settled([task({ id: 't1', isDefaultTask: true })]),
    )
    render(<CampaignStrategySection />)
    expect(screen.queryByText(/Finding local events/)).not.toBeInTheDocument()
  })

  it('says what was added since the plan was last shown, and marks it New', () => {
    window.localStorage.setItem(
      'tracker-known-tasks:55',
      JSON.stringify(['t1']),
    )
    mockTasks.mockReturnValue(
      settled([
        task({ id: 't1', title: 'Get your EIN' }),
        task({ id: 't2', title: 'Attend the town hall' }),
      ]),
    )
    render(<CampaignStrategySection />)

    expect(mockSuccessSnackbar).toHaveBeenCalledWith(
      'Added to your plan: Attend the town hall',
      expect.objectContaining({ action: undefined }),
    )
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('stays quiet the first time it sees a campaign', () => {
    mockTasks.mockReturnValue(settled([task({ id: 't1' })]))
    render(<CampaignStrategySection />)
    expect(mockSuccessSnackbar).not.toHaveBeenCalled()
  })
})

describe('CampaignStrategySection — tracker viewed event', () => {
  it('fires once the tracker renders, with its task counts and phase', () => {
    mockTasks.mockReturnValue(
      settled([
        task({ id: 't1', phase: 'launch' }),
        task({ id: 't2', phase: 'launch', completed: true }),
      ]),
    )
    const { rerender } = render(<CampaignStrategySection />)

    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'Campaign Plan - Campaign Tracker Viewed',
      {
        taskCount: 2,
        tasksCompleted: 1,
        activePhase: 'launch',
      },
    )

    // A poll refetch re-renders the section; the event stays once per campaign.
    rerender(<CampaignStrategySection />)
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('fires again on a later visit, so return views are measurable', () => {
    mockTasks.mockReturnValue(settled([task({ id: 't1', phase: 'launch' })]))
    const first = render(<CampaignStrategySection />)
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)

    // Navigating away and back is a genuine second view, unlike the poll
    // refetches the in-mount guard swallows above.
    first.unmount()
    render(<CampaignStrategySection />)
    expect(mockTrackEvent).toHaveBeenCalledTimes(2)
  })

  it('counts Active-phase tasks, which live in weeks rather than groups', () => {
    const today = new Date().toISOString().slice(0, 10)
    mockTasks.mockReturnValue(
      settled([
        task({ id: 'a1', phase: 'active', date: `${today}T00:00:00.000Z` }),
        task({ id: 'l1', phase: 'launch' }),
      ]),
    )
    render(<CampaignStrategySection />)

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'Campaign Plan - Campaign Tracker Viewed',
      expect.objectContaining({ taskCount: 2 }),
    )
  })

  it('still fires for a static-only view, before the dynamic tasks land', () => {
    mockTasks.mockReturnValue({
      ...settled([task({ id: 's1', phase: 'launch', isDefaultTask: true })]),
      isGeneratingDynamic: true,
    })
    render(<CampaignStrategySection />)

    // The candidate saw their tracker even though it is not fully personalized
    // yet; taskCount is what marks the view as static-only.
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'Campaign Plan - Campaign Tracker Viewed',
      expect.objectContaining({ taskCount: 1 }),
    )
  })

  it('does not fire while the tracker is still bootstrapping', () => {
    mockTasks.mockReturnValue(settled([]))
    render(<CampaignStrategySection />)

    expect(
      screen.getByText('Your campaign plan is being created'),
    ).toBeInTheDocument()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})

describe('CampaignStrategySection — head start', () => {
  // A Thursday: this week runs Oct 5-11, next week Oct 12-18.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    window.localStorage.clear()
    return () => {
      vi.useRealTimers()
      window.localStorage.clear()
    }
  })

  const weeks = [
    task({
      id: 'done',
      phase: 'active',
      date: '2026-10-06T00:00:00.000Z',
      completed: true,
    }),
    task({
      id: 'ahead',
      title: 'Next week task',
      phase: 'active',
      date: '2026-10-13T00:00:00.000Z',
    }),
  ]

  it('lists this week and next week together, like every other phase', () => {
    mockTasks.mockReturnValue(settled(weeks))
    render(<CampaignStrategySection />)

    expect(screen.queryByRole('button', { name: 'Next week' })).toBeNull()
    expect(screen.getByText('Next week task')).toBeInTheDocument()
  })

  it('marks next week’s first task next after a head start', () => {
    window.localStorage.setItem('next-task-head-start', '2026-10-12')
    mockTasks.mockReturnValue(settled(weeks))
    const { container } = render(<CampaignStrategySection />)

    expect(container.querySelector('[data-next-task]')?.textContent).toContain(
      'Next week task',
    )
  })
})

describe('CampaignStrategySection — phase progress', () => {
  it('fills each phase’s bar by its done tasks, leaving out not-for-me ones', () => {
    mockTasks.mockReturnValue(
      settled([
        task({ id: 'a', phase: 'launch', completed: true }),
        task({ id: 'b', phase: 'launch' }),
        task({ id: 'c', phase: 'launch', skipReason: 'notForMe' }),
      ]),
    )
    render(<CampaignStrategySection />)

    expect(
      screen.getByRole('progressbar', { name: 'Launch: 1 of 2 done' }),
    ).toBeInTheDocument()
  })
})
