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
    expect(onStartOutreach).toHaveBeenCalledWith(
      'text',
      '2026-02-03T00:00:00.000Z',
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
