import { describe, expect, it } from 'vitest'
import { startOfDay, subDays, subWeeks } from 'date-fns'
import {
  CAMPAIGN_TASK_CATALOG,
  VOTER_CONTACT_SCHEDULE,
} from '@goodparty_org/contracts'
import {
  buildOutreachTrackerTaskRows,
  buildStaticTrackerTaskRows,
} from './staticTrackerTasks.util'

describe('buildStaticTrackerTaskRows', () => {
  const start = startOfDay(new Date('2026-01-01'))
  const election = startOfDay(new Date('2026-11-03'))
  const staticTasks = CAMPAIGN_TASK_CATALOG.filter((t) => t.type === 'static')

  it('builds one row per static catalog task, marked default', () => {
    const rows = buildStaticTrackerTaskRows(7, start, election)
    expect(rows).toHaveLength(staticTasks.length)
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
    expect(rows.every((r) => r.campaignId === 7)).toBe(true)
    expect(rows.every((r) => Boolean(r.phase))).toBe(true)
  })

  it('dates election-relative tasks off the election date', () => {
    const task = staticTasks.find((t) => t.timing.kind === 'electionRelative')
    expect(task).toBeDefined()
    if (!task || task.timing.kind !== 'electionRelative') return
    const rows = buildStaticTrackerTaskRows(7, start, election)
    const row = rows.find((r) => r.title === task.title)
    const expected =
      task.timing.unit === 'weeks'
        ? subWeeks(election, task.timing.offset)
        : subDays(election, task.timing.offset)
    expect(row?.date).toEqual(expected)
  })

  it('anchors jurisdiction-timed tasks to start (no plan date yet)', () => {
    const task = staticTasks.find((t) => t.timing.kind === 'jurisdiction')
    expect(task).toBeDefined()
    if (!task) return
    const rows = buildStaticTrackerTaskRows(7, start, election)
    expect(rows.find((r) => r.title === task.title)?.date).toEqual(start)
  })

  it('falls back to start for election-relative tasks with no election', () => {
    const task = staticTasks.find((t) => t.timing.kind === 'electionRelative')
    if (!task) return
    const rows = buildStaticTrackerTaskRows(7, start, null)
    expect(rows.find((r) => r.title === task.title)?.date).toEqual(start)
  })
})

describe('buildOutreachTrackerTaskRows', () => {
  const start = startOfDay(new Date('2026-01-01'))
  const election = startOfDay(new Date('2026-11-03'))

  it('builds the 7 plan contact-schedule sends (4 text + 3 robocall)', () => {
    const rows = buildOutreachTrackerTaskRows(7, start, election, false)
    expect(rows).toHaveLength(7)
    expect(rows.filter((r) => r.flowType === 'text')).toHaveLength(4)
    expect(rows.filter((r) => r.flowType === 'robocall')).toHaveLength(3)
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
    expect(rows.every((r) => r.campaignId === 7)).toBe(true)
  })

  it('dates each send per the canonical contact schedule', () => {
    const rows = buildOutreachTrackerTaskRows(7, start, election, false)
    const dates = rows.map((r) => r.date as Date)
    for (const send of VOTER_CONTACT_SCHEDULE) {
      expect(dates).toContainEqual(subDays(election, send.daysBeforeElection))
    }
  })

  it('suppresses all outreach when the candidate lost their primary', () => {
    expect(buildOutreachTrackerTaskRows(7, start, election, true)).toEqual([])
  })
})
