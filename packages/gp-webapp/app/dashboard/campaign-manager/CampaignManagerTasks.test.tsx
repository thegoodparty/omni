import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import CampaignManagerTasks from './CampaignManagerTasks'

const mockResult = vi.fn<() => TrackerTasksResult>()
const mockToggle = vi.fn()
vi.mock('../campaign-plan/components/campaignStrategy/useTrackerTasks', () => ({
  useTrackerTasks: () => mockResult(),
  useToggleTrackerTaskComplete: () => ({
    mutate: mockToggle,
    isPending: false,
  }),
}))

// The first-run "meet" card gates on whether the candidate has ever opened the
// manager (a conversation exists). Control that here; default to none.
const mockHistory = vi.fn<() => { data: unknown[] | undefined }>()
vi.mock('../chief-of-staff/data/use-chat-history', () => ({
  useChatHistory: () => mockHistory(),
}))

// Stub the count modal to a submit button so we can assert the completion
// wiring (type + quantity) without driving its internals.
vi.mock('../components/tasks/CountModal', () => ({
  default: ({
    flowType,
    onSubmit,
  }: {
    flowType: string
    onSubmit: (count: number) => void
  }) => (
    <div>
      <span>count-modal:{flowType}</span>
      <button type="button" onClick={() => onSubmit(42)}>
        submit-count
      </button>
    </div>
  ),
}))

const meetButton = () =>
  screen.queryByRole('button', { name: /meet your campaign manager/i })

beforeEach(() => {
  mockHistory.mockReturnValue({ data: [] })
  mockToggle.mockClear()
})

const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: Math.random().toString(36).slice(2),
  title: 'task',
  description: '',
  cta: null,
  link: null,
  flowType: null,
  week: 1,
  date: '2026-07-01T00:00:00.000Z',
  completed: false,
  phase: null,
  proRequired: null,
  isDefaultTask: false,
  ...over,
})

const settled = (tasks: CampaignTrackerTask[]): TrackerTasksResult => ({
  tasks,
  isPending: false,
  isError: false,
  isGeneratingDynamic: false,
})

describe('CampaignManagerTasks', () => {
  it('renders the top 3 dynamic tasks, excluding static and completed', () => {
    mockResult.mockReturnValue(
      settled([
        task({
          title: 'Knock 50 doors',
          week: 2,
          date: '2026-07-02T00:00:00.000Z',
        }),
        task({
          title: 'Call your donors',
          week: 2,
          date: '2026-07-01T00:00:00.000Z',
        }),
        task({
          title: 'Post an update',
          week: 2,
          date: '2026-07-03T00:00:00.000Z',
        }),
        task({
          title: 'Send GOTV text',
          week: 2,
          date: '2026-07-04T00:00:00.000Z',
        }),
        task({ title: 'Register on ballot', isDefaultTask: true, week: 99 }),
        task({ title: 'Done already', week: 2, completed: true }),
      ]),
    )

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    // top 3 by date asc among incomplete dynamic latest-gen
    expect(screen.getByText('Call your donors')).toBeInTheDocument()
    expect(screen.getByText('Knock 50 doors')).toBeInTheDocument()
    expect(screen.getByText('Post an update')).toBeInTheDocument()
    // 4th dynamic task and the static/completed ones are not shown
    expect(screen.queryByText('Send GOTV text')).not.toBeInTheDocument()
    expect(screen.queryByText('Register on ballot')).not.toBeInTheDocument()
    expect(screen.queryByText('Done already')).not.toBeInTheDocument()
  })

  it('links each card CTA to the task action, falling back to the tracker', () => {
    mockResult.mockReturnValue(
      settled([
        task({
          title: 'With link',
          week: 1,
          cta: 'Knock doors',
          link: '/dashboard/outreach/doors',
        }),
        task({ title: 'No link', week: 1, cta: null, link: null }),
      ]),
    )

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Knock doors' })).toHaveAttribute(
      'href',
      '/dashboard/outreach/doors',
    )
    // A task with no cta of its own falls back to a "See details" link → tracker.
    expect(screen.getByRole('link', { name: 'See details' })).toHaveAttribute(
      'href',
      '/dashboard/campaign-plan',
    )
  })

  it('opens an external task link in a new tab, like the tracker', () => {
    mockResult.mockReturnValue(
      settled([
        task({
          title: 'File your paperwork',
          week: 1,
          cta: null,
          link: 'https://www.sos.state.co.us/candidate',
        }),
      ]),
    )

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    const cta = screen.getByRole('link', { name: 'Open' })
    expect(cta).toHaveAttribute('href', 'https://www.sos.state.co.us/candidate')
    expect(cta).toHaveAttribute('target', '_blank')
    expect(cta).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  it('treats an empty-string link as no link (no broken href)', () => {
    mockResult.mockReturnValue(
      settled([task({ title: 'Empty link', week: 1, cta: null, link: '' })]),
    )

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'See details' })).toHaveAttribute(
      'href',
      '/dashboard/campaign-plan',
    )
  })

  it('renders each task as a rich card with a category eyebrow and summary', () => {
    mockResult.mockReturnValue(
      settled([
        task({
          title: 'Knock 60 doors in Maplewood',
          week: 1,
          flowType: 'doorKnocking',
          description: 'Highest-persuasion turf; closes your contact gap.',
        }),
      ]),
    )

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(
      screen.getByText('Highest-persuasion turf; closes your contact gap.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Knock 60 doors in Maplewood')).toBeInTheDocument()
  })

  it('shows the "meet your campaign manager" button and fires the callback', async () => {
    const onMeet = vi.fn()
    mockResult.mockReturnValue(settled([task({ title: 'A task', week: 1 })]))

    const user = userEvent.setup()
    render(<CampaignManagerTasks onMeetManager={onMeet} />)
    await user.click(
      screen.getByRole('button', { name: /meet your campaign manager/i }),
    )

    expect(onMeet).toHaveBeenCalledOnce()
  })

  it('hides the meet card once the candidate has opened the manager', () => {
    mockResult.mockReturnValue(settled([task({ title: 'A task', week: 1 })]))
    // A conversation exists → they have opened the manager before.
    mockHistory.mockReturnValue({ data: [{ conversationId: 'c1' }] })

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(meetButton()).not.toBeInTheDocument()
    // The priorities still render.
    expect(screen.getByText('A task')).toBeInTheDocument()
  })

  it('does not show the meet card until the history has loaded', () => {
    mockResult.mockReturnValue(settled([task({ title: 'A task', week: 1 })]))
    mockHistory.mockReturnValue({ data: undefined })

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(meetButton()).not.toBeInTheDocument()
  })

  it('marks a non-count task done directly, without a voter count', async () => {
    const t = task({
      title: 'Get Meta verified',
      week: 1,
      flowType: 'awareness',
    })
    mockResult.mockReturnValue(settled([t]))
    const user = userEvent.setup()
    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Mark done' }))

    expect(mockToggle).toHaveBeenCalledWith({ id: t.id, completed: true })
    expect(screen.queryByText(/count-modal/)).not.toBeInTheDocument()
  })

  it('records a voter-contact count when completing a community-event task', async () => {
    const t = task({
      title: 'Greet voters at the polls',
      week: 1,
      flowType: 'events',
    })
    mockResult.mockReturnValue(settled([t]))
    const user = userEvent.setup()
    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    // Completing an events task opens the count prompt instead of completing.
    await user.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(mockToggle).not.toHaveBeenCalled()
    expect(screen.getByText('count-modal:events')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit-count' }))
    expect(mockToggle).toHaveBeenCalledWith({
      id: t.id,
      completed: true,
      type: 'events',
      quantity: 42,
    })
  })

  it('shows a generating state while dynamic tasks are still being produced', () => {
    mockResult.mockReturnValue({
      tasks: [task({ isDefaultTask: true, week: 1 })],
      isPending: false,
      isError: false,
      isGeneratingDynamic: true,
    })

    render(<CampaignManagerTasks onMeetManager={vi.fn()} />)

    expect(screen.getByText(/preparing/i)).toBeInTheDocument()
  })
})
