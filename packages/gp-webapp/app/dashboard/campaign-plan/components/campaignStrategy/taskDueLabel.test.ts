import { describe, expect, it } from 'vitest'
import { taskDueLabel } from './CampaignStrategyTaskRow'

describe('taskDueLabel', () => {
  const today = new Date('2026-10-07T15:00:00')

  it('stays plain while the date is a while off', () => {
    expect(taskDueLabel('2026-10-14T00:00:00.000Z', today)).toEqual({
      label: 'Due Oct 14',
      urgent: false,
    })
  })

  it('says today and tomorrow in words, as urgent', () => {
    expect(taskDueLabel('2026-10-07', today)).toEqual({
      label: 'Due today',
      urgent: true,
    })
    expect(taskDueLabel('2026-10-08T00:00:00.000Z', today)).toEqual({
      label: 'Due tomorrow',
      urgent: true,
    })
  })

  it('counts the days a late task is overdue', () => {
    expect(taskDueLabel('2026-10-04T00:00:00.000Z', today)).toEqual({
      label: '3 days overdue',
      urgent: true,
    })
    expect(taskDueLabel('2026-10-06', today)).toEqual({
      label: '1 day overdue',
      urgent: true,
    })
  })

  it('shows nothing for an undated task', () => {
    expect(taskDueLabel(null, today)).toBeNull()
  })
})
