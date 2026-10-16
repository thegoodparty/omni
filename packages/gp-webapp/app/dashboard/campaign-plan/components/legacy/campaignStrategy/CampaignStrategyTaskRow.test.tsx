import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import CampaignStrategyTaskRow, {
  formatTaskDate,
} from './CampaignStrategyTaskRow'

const { mockSmsCompliance } = vi.hoisted(() => ({
  mockSmsCompliance: {
    current: {
      smsCompliance: 'open',
      smsCutoffDate: null as string | null,
      generalElectionDate: null as string | null,
    },
  },
}))
vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: () => mockSmsCompliance.current,
}))

describe('formatTaskDate', () => {
  // The catalog fallback passes date-only strings; the tracker passes the API's
  // full ISO datetime. Both must format without throwing (the full ISO form
  // used to become an Invalid Date and crash the row render).
  it('formats a date-only string', () => {
    expect(formatTaskDate('2026-07-11')).toBe('Jul 11')
  })

  it('formats a full ISO datetime (the tracker/API shape)', () => {
    expect(formatTaskDate('2026-07-11T00:00:00.000Z')).toBe('Jul 11')
  })

  it('returns null when there is no date', () => {
    expect(formatTaskDate(null)).toBeNull()
  })
})

describe('start outreach CTA', () => {
  const task = {
    id: 't1',
    title: 'Send a text blast',
    description: 'Reach voters by text',
    channel: 'text',
    date: '2026-02-03T00:00:00.000Z',
    param: null,
    href: null,
    hrefLabel: null,
    priorityTier: 'P2',
    proRequired: false,
    status: 'live',
    unlocksAfter: null,
    isNext: false,
    completed: false,
  } as const

  it('opens the outreach flow in place with the channel and due date', () => {
    const onStartOutreach = vi.fn()
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={task}
          index={1}
          onStartOutreach={onStartOutreach}
        />
      </ul>,
    )
    fireEvent.click(screen.getByRole('button', { name: /start outreach/i }))
    // The task id rides the callback so the hub can put `trackerTaskId` on
    // the outreach completion event — see
    // docs/features/voter-outreach-analytics.md.
    expect(onStartOutreach).toHaveBeenCalledWith(
      'text',
      '2026-02-03T00:00:00.000Z',
      task.id,
    )
  })

  it('renders no outreach CTA for a completed task', () => {
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={{ ...task, completed: true }}
          index={1}
          onStartOutreach={vi.fn()}
        />
      </ul>,
    )
    expect(
      screen.queryByRole('button', { name: /start outreach/i }),
    ).not.toBeInTheDocument()
  })

  it('renders no outreach CTA for non-compose channels', () => {
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={{ ...task, channel: 'doorKnocking' }}
          index={1}
          onStartOutreach={vi.fn()}
        />
      </ul>,
    )
    expect(
      screen.queryByRole('button', { name: /start outreach/i }),
    ).not.toBeInTheDocument()
  })
})

describe('a text task once texting is closed', () => {
  const textTask = {
    id: 't9',
    title: 'Send an introduction text',
    description: 'Introduce yourself to voters with cellphones.',
    channel: 'text',
    date: '2099-02-03T00:00:00.000Z',
    param: null,
    href: null,
    hrefLabel: null,
    priorityTier: 'P2',
    proRequired: false,
    status: 'live',
    unlocksAfter: null,
    isNext: true,
    completed: false,
  } as const

  it('disables Start outreach and gives the reason on hover', async () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    const onStartOutreach = vi.fn()
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={textTask}
          index={1}
          onStartOutreach={onStartOutreach}
        />
      </ul>,
    )
    const button = screen.getByRole('button', { name: /start outreach/i })
    expect(button).toBeDisabled()
    await userEvent.hover(button.parentElement as HTMLElement)
    expect(
      (await screen.findAllByText(/deadline to get verified for texting/))
        .length,
    ).toBeGreaterThan(0)
  })

  it('keeps a robocall task’s Start outreach', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    const onStartOutreach = vi.fn()
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={{ ...textTask, channel: 'robocall' }}
          index={1}
          onStartOutreach={onStartOutreach}
        />
      </ul>,
    )
    fireEvent.click(screen.getByRole('button', { name: /start outreach/i }))
    expect(onStartOutreach).toHaveBeenCalledWith(
      'robocall',
      textTask.date,
      textTask.id,
    )
  })
})
