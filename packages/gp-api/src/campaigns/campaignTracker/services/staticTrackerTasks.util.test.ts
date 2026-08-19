import { describe, expect, it } from 'vitest'
import { startOfDay, subDays, subWeeks } from 'date-fns'
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
  VOTER_CONTACT_SCHEDULE,
} from '@goodparty_org/contracts'
import {
  BALLOT_ACCESS_TASK_TITLES,
  buildBallotAccessTrackerTaskRows,
  buildOutreachTrackerTaskRows,
  buildStaticTrackerTaskRows,
  needsBallotAccessTasks,
  resolveBallotStatus,
} from './staticTrackerTasks.util'

describe('buildStaticTrackerTaskRows', () => {
  const start = startOfDay(new Date('2026-01-01'))
  const election = startOfDay(new Date('2026-11-03'))
  const staticTasks = CAMPAIGN_TASK_CATALOG.filter((t) => t.type === 'static')

  it('builds one row per static catalog task, marked default', () => {
    const rows = buildStaticTrackerTaskRows(7, start, election, true)
    expect(rows).toHaveLength(staticTasks.length)
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
    expect(rows.every((r) => r.campaignId === 7)).toBe(true)
    expect(rows.every((r) => Boolean(r.phase))).toBe(true)
  })

  it('dates election-relative tasks off the election date', () => {
    const task = staticTasks.find((t) => t.timing.kind === 'electionRelative')
    expect(task).toBeDefined()
    if (!task || task.timing.kind !== 'electionRelative') return
    const rows = buildStaticTrackerTaskRows(7, start, election, true)
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
    const rows = buildStaticTrackerTaskRows(7, start, election, true)
    expect(rows.find((r) => r.title === task.title)?.date).toEqual(start)
  })

  it('falls back to start for election-relative tasks with no election', () => {
    const task = staticTasks.find((t) => t.timing.kind === 'electionRelative')
    if (!task) return
    const rows = buildStaticTrackerTaskRows(7, start, null, true)
    expect(rows.find((r) => r.title === task.title)?.date).toEqual(start)
  })

  it('drops the ballot-access rows when they are not included', () => {
    const rows = buildStaticTrackerTaskRows(7, start, election, false)
    expect(BALLOT_ACCESS_TASK_TITLES).toHaveLength(2)
    for (const title of BALLOT_ACCESS_TASK_TITLES) {
      expect(rows.some((r) => r.title === title)).toBe(false)
    }
    expect(rows).toHaveLength(staticTasks.length - 2)
  })
})

describe('buildBallotAccessTrackerTaskRows', () => {
  const start = startOfDay(new Date('2026-01-01'))

  it('builds only the ballot-access catalog rows, anchored to start', () => {
    const rows = buildBallotAccessTrackerTaskRows(7, start, null)
    expect(rows.map((r) => r.title).sort()).toEqual(
      [...BALLOT_ACCESS_TASK_TITLES].sort(),
    )
    expect(rows.map((r) => r.date)).toEqual([start, start])
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
  })
})

describe('resolveBallotStatus / needsBallotAccessTasks', () => {
  const campaign = (
    details: Record<string, unknown>,
    data: Record<string, unknown> = {},
  ) => ({ details, data }) as never

  it.each([
    ['on-ballot', false],
    ['qualified-not-filed', true],
    ['considering', true],
    // A tire-kicker is by definition not on the ballot, and their pre-launch
    // phase is what they are evaluating, so they still see the real path.
    ['testing', true],
  ] as const)('%s -> needs ballot access: %s', (ballotStatus, expected) => {
    const c = campaign({ ballotStatus })
    expect(resolveBallotStatus(c)).toBe(ballotStatus)
    expect(needsBallotAccessTasks(c)).toBe(expected)
  })

  it('keeps ballot access when the answer is absent', () => {
    const c = campaign({})
    expect(resolveBallotStatus(c)).toBeNull()
    expect(needsBallotAccessTasks(c)).toBe(true)
  })

  it('falls back to the data.onboarding copy of the answer', () => {
    const c = campaign({}, { onboarding: { ballotStatus: 'on-ballot' } })
    expect(resolveBallotStatus(c)).toBe('on-ballot')
    expect(needsBallotAccessTasks(c)).toBe(false)
  })

  it('prefers details.ballotStatus over the onboarding snapshot', () => {
    const c = campaign(
      { ballotStatus: 'qualified-not-filed' },
      { onboarding: { ballotStatus: 'on-ballot' } },
    )
    expect(resolveBallotStatus(c)).toBe('qualified-not-filed')
    expect(needsBallotAccessTasks(c)).toBe(true)
  })
})

describe('BALLOT_ACCESS_TASK_TITLES', () => {
  it('covers every catalog task in the ballot-access category', () => {
    const titles = CAMPAIGN_TASK_CATALOG.filter(
      (t) => t.category === BALLOT_ACCESS_CATEGORY,
    ).map((t) => t.title)
    expect(BALLOT_ACCESS_TASK_TITLES).toEqual(titles)
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
