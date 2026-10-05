import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import CampaignStrategyTaskRow, {
  formatTaskDate,
} from './CampaignStrategyTaskRow'

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
    skipReason: null,
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

describe('a task set aside as not for me', () => {
  const task = {
    id: 't2',
    title: 'Order yard signs',
    description: 'Get signs printed',
    channel: 'general',
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
    skipReason: 'notForMe',
  } as const

  it('says so and offers Undo', () => {
    const onUndoSkip = vi.fn()
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={task}
          index={1}
          onUndoSkip={onUndoSkip}
        />
      </ul>,
    )
    expect(screen.getByText('Not for me')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndoSkip).toHaveBeenCalledWith('t2')
  })

  it('shows no Undo for a task snoozed for later', () => {
    render(
      <ul>
        <CampaignStrategyTaskRow
          task={{ ...task, skipReason: 'later' }}
          index={1}
          onUndoSkip={vi.fn()}
        />
      </ul>,
    )
    expect(screen.queryByText('Not for me')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Undo' }),
    ).not.toBeInTheDocument()
  })
})
