import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  } as const

  it('opens the outreach flow in place with the channel and due date', async () => {
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
    // The row's own actions sit in its "More options" menu.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /start outreach/i }),
    )
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
    // With no outreach to start and nothing else to do, the row has no menu.
    expect(
      screen.queryByRole('button', { name: 'More options' }),
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
    // With no outreach to start and nothing else to do, the row has no menu.
    expect(
      screen.queryByRole('button', { name: 'More options' }),
    ).not.toBeInTheDocument()
  })
})
