import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import NextThingCard from './NextThingCard'

const mockResult = vi.fn<() => TrackerTasksResult>()
const mockToggle = vi.fn()
const mockSkip = vi.fn()
vi.mock(
  '../campaign-plan/components/campaignStrategy/useTrackerTasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../campaign-plan/components/campaignStrategy/useTrackerTasks')
    >()),
    useTrackerTasks: () => mockResult(),
    useToggleTrackerTaskComplete: () => ({
      mutate: mockToggle,
      isPending: false,
    }),
    useSkipTrackerTask: () => ({ mutate: mockSkip, isPending: false }),
  }),
)

let mockBallotStatus: string | undefined = 'on-ballot'
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, ballotStatus: mockBallotStatus, details: {} }],
}))

const mockChatAboutTask = vi.fn()
vi.mock('../campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => ({ chatAboutTask: mockChatAboutTask }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('../shared/FilingInstructionsDetails', () => ({
  default: () => <div>filing-instructions</div>,
}))

vi.mock('./useSessionHeadline', () => ({
  useSessionHeadline: () => "Let's get to work",
}))
vi.mock('../components/tasks/CountModal', () => ({
  default: ({ onSubmit }: { onSubmit: (count: number) => void }) => (
    <button type="button" onClick={() => onSubmit(42)}>
      submit-count
    </button>
  ),
}))

const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: 'task-1',
  title: 'Plan your launch event',
  description: 'Pick a date and a place.',
  cta: null,
  link: null,
  flowType: null,
  week: 0,
  date: '2099-07-01T00:00:00.000Z',
  completed: false,
  phase: 'launch',
  proRequired: null,
  isDefaultTask: true,
  skipReason: null,
  snoozedUntil: null,
  ...over,
})

const settled = (tasks: CampaignTrackerTask[]): TrackerTasksResult => ({
  tasks,
  isPending: false,
  isError: false,
  isGeneratingDynamic: false,
})

beforeEach(() => {
  mockBallotStatus = 'on-ballot'
  mockToggle.mockClear()
  mockSkip.mockClear()
  mockChatAboutTask.mockClear()
  vi.mocked(trackEvent).mockClear()
})

describe('NextThingCard', () => {
  it('shows the one task to do next, in plan order, under the session headline', () => {
    mockResult.mockReturnValue(
      settled([
        task({ id: 'later', title: 'Knock doors', phase: 'active' }),
        task({ id: 'first', title: 'Order yard signs', phase: 'preLaunch' }),
      ]),
    )
    render(<NextThingCard />)

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: "Let's get to work",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Order yard signs' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Knock doors')).not.toBeInTheDocument()
  })

  it('records one view per task shown', () => {
    mockResult.mockReturnValue(settled([task({})]))
    const { rerender } = render(<NextThingCard />)
    rerender(<NextThingCard />)

    const views = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([event]) => event === EVENTS.Dashboard.CampaignPlan.NextThingViewed,
      )
    expect(views).toHaveLength(1)
    expect(views[0]?.[1]).toMatchObject({
      trackerTaskId: 'task-1',
      phase: 'launch',
      candidateStage: 'on-ballot',
    })
  })

  describe('reason tag', () => {
    it('gives a scheduled send its deadline', () => {
      mockResult.mockReturnValue(
        settled([
          task({ id: 'done', completed: true }),
          task({ flowType: 'text', date: '2099-11-14T00:00:00.000Z' }),
        ]),
      )
      render(<NextThingCard />)

      expect(screen.getByText('Deadline Nov 14')).toBeInTheDocument()
    })

    it('shows no standing label when there is no date, not even before anything is done', () => {
      mockResult.mockReturnValue(settled([task({})]))
      render(<NextThingCard />)

      expect(screen.queryByText('Start here')).not.toBeInTheDocument()
      expect(screen.queryByText(/deadline/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/high priority/i)).not.toBeInTheDocument()
    })
  })

  it('shows no progress count, and puts the plan link in the menu', async () => {
    mockResult.mockReturnValue(
      settled([task({ id: 'a', completed: true }), task({ id: 'b' })]),
    )
    render(<NextThingCard />)

    expect(screen.queryByText(/of 2 done/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(
      await screen.findByRole('menuitem', { name: 'See it in your plan' }),
    ).toHaveAttribute('href', '/campaign-plan')
  })

  it("links the main action to the task's own link", () => {
    mockResult.mockReturnValue(
      settled([task({ link: '/campaign-story', cta: 'Add your story' })]),
    )
    render(<NextThingCard />)

    expect(
      screen.getByRole('link', { name: 'Add your story' }),
    ).toHaveAttribute('href', '/campaign-story')
  })

  it('starts outreach for a text task with no link of its own', () => {
    mockResult.mockReturnValue(settled([task({ flowType: 'text' })]))
    render(<NextThingCard />)

    const link = screen.getByRole('link', { name: 'Start outreach' })
    expect(link.getAttribute('href')).toContain('compose=text')
  })

  it('marks a task done and records the completion', async () => {
    mockResult.mockReturnValue(settled([task({})]))
    render(<NextThingCard />)

    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))

    expect(mockToggle).toHaveBeenCalledWith({ id: 'task-1', completed: true })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.NextThingCompleted,
      expect.objectContaining({ trackerTaskId: 'task-1' }),
    )
  })

  it('asks how many voters were reached before completing an outreach task', async () => {
    mockResult.mockReturnValue(settled([task({ flowType: 'doorKnocking' })]))
    render(<NextThingCard />)

    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(mockToggle).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'submit-count' }))
    expect(mockToggle).toHaveBeenCalledWith({
      id: 'task-1',
      completed: true,
      type: 'doorKnocking',
      quantity: 42,
    })
  })

  it.each([
    ['Later', 'later'],
    ['Not for me', 'notForMe'],
  ])('skips from the "More options" menu with "%s"', async (label, reason) => {
    mockResult.mockReturnValue(settled([task({})]))
    render(<NextThingCard />)

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByText(label))

    expect(mockSkip).toHaveBeenCalledWith({ id: 'task-1', reason })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.NextThingSkipped,
      expect.objectContaining({ trackerTaskId: 'task-1', reason }),
    )
  })

  it('opens a chat about the task, with questions about it to start from', async () => {
    const shown = task({})
    mockResult.mockReturnValue(settled([shown]))
    render(<NextThingCard />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Chat about this' }),
    )

    expect(mockChatAboutTask).toHaveBeenCalledWith(shown, [
      'Help me get this done',
      'Why does this matter for my race?',
    ])
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.NextThingStarted,
      expect.objectContaining({ via: 'chat' }),
    )
  })

  describe('for a candidate who is not on the ballot', () => {
    beforeEach(() => {
      mockBallotStatus = 'qualified-not-filed'
      mockResult.mockReturnValue(
        settled([
          task({ id: 'other' }),
          task({
            id: 'ballot',
            title: 'Submit your Ballot Access Signatures',
            phase: 'preLaunch',
          }),
        ]),
      )
    })

    it('leads with getting on the ballot and shows how to file', async () => {
      render(<NextThingCard />)

      expect(
        screen.getByRole('heading', { level: 2, name: "Let's get to work" }),
      ).toBeInTheDocument()
      await userEvent.click(
        screen.getByRole('button', { name: 'See how to file' }),
      )
      expect(await screen.findByText('filing-instructions')).toBeInTheDocument()
    })

    it('starts the chat from ballot questions', async () => {
      render(<NextThingCard />)

      await userEvent.click(
        screen.getByRole('button', { name: 'Chat about this' }),
      )
      expect(mockChatAboutTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ballot' }),
        [
          'How many signatures do I need?',
          'Where do I file, and what does it cost?',
        ],
      )
    })
  })

  it('keeps the headline while the plan is still coming together', () => {
    mockResult.mockReturnValue(settled([]))
    render(<NextThingCard />)

    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText(/your first step will show up here/i),
    ).toBeInTheDocument()
  })

  it('says the candidate is caught up when nothing is left', () => {
    mockResult.mockReturnValue(settled([task({ completed: true })]))
    render(<NextThingCard />)

    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
  })
})
