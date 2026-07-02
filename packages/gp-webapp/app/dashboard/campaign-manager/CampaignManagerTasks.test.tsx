import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import CampaignManagerTasks from './CampaignManagerTasks'

const mockResult = vi.fn<() => TrackerTasksResult>()
vi.mock('../campaign-plan/components/campaignStrategy/useTrackerTasks', () => ({
  useTrackerTasks: () => mockResult(),
}))

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
