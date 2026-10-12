import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Tracker dates are naive calendar days at UTC midnight, so the expectations
// do day arithmetic in UTC too (date-fns works in local time, which shifts an
// hour across a DST change and a day on a server west of UTC).
const DAY_MS = 24 * 60 * 60 * 1000
const startOfDay = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS)
const subDays = (date: Date, days: number): Date => addDays(date, -days)
const subWeeks = (date: Date, weeks: number): Date => addDays(date, -weeks * 7)
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_STORY_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
  VOTER_CONTACT_SCHEDULE,
} from '@goodparty_org/contracts'
import {
  BALLOT_ACCESS_TASK_TITLES,
  buildBallotAccessTrackerTaskRows,
  buildCampaignStoryTrackerTaskRows,
  buildOutreachTrackerTaskRows,
  buildStaticTrackerTaskRows,
  CAMPAIGN_STORY_TASK_TITLES,
  needsBallotAccessTasks,
} from './staticTrackerTasks.util'

describe('buildStaticTrackerTaskRows', () => {
  const start = startOfDay(new Date('2026-01-01'))
  const election = startOfDay(new Date('2026-11-03'))
  // The story row is built separately (it carries a link and CTA), so it is
  // deliberately not part of this builder's output.
  const staticTasks = CAMPAIGN_TASK_CATALOG.filter(
    (t) => t.type === 'static' && t.category !== CAMPAIGN_STORY_CATEGORY,
  )

  it('builds one row per static catalog task, marked default', () => {
    const rows = buildStaticTrackerTaskRows(7, start, election, true)
    expect(rows).toHaveLength(staticTasks.length)
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
    expect(rows.every((r) => r.campaignId === 7)).toBe(true)
    expect(rows.every((r) => Boolean(r.phase))).toBe(true)
  })

  it('never emits the story row', () => {
    const rows = buildStaticTrackerTaskRows(7, start, election, true)
    for (const title of CAMPAIGN_STORY_TASK_TITLES) {
      expect(rows.map((r) => r.title)).not.toContain(title)
    }
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

describe('needsBallotAccessTasks', () => {
  const campaign = (ballotStatus: string | null) => ({ ballotStatus }) as never

  it.each([
    ['on-ballot', false],
    ['qualified-not-filed', true],
    ['considering', true],
    // A tire-kicker is by definition not on the ballot, and their pre-launch
    // phase is what they are evaluating, so they still see the real path.
    ['testing', true],
  ] as const)('%s -> needs ballot access: %s', (ballotStatus, expected) => {
    expect(needsBallotAccessTasks(campaign(ballotStatus))).toBe(expected)
  })

  it('keeps ballot access when the answer is absent', () => {
    expect(needsBallotAccessTasks(campaign(null))).toBe(true)
  })

  // The column is a plain String?, so an unrecognised value is possible. It
  // must read as unanswered: dropping a filing deadline on the strength of a
  // value we cannot interpret is the one unrecoverable outcome here.
  it('treats an unrecognised value as unanswered', () => {
    expect(needsBallotAccessTasks(campaign('maybe'))).toBe(true)
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

  it('builds no outreach when there is no election date to anchor to', () => {
    expect(buildOutreachTrackerTaskRows(7, start, null, false)).toEqual([])
  })
})

describe('buildCampaignStoryTrackerTaskRows', () => {
  const anchor = new Date('2026-06-08T00:00:00Z')
  const election = startOfDay(new Date('2026-11-03'))

  it('builds the one story row as a default task', () => {
    const rows = buildCampaignStoryTrackerTaskRows(7, anchor, election)
    expect(rows).toHaveLength(CAMPAIGN_STORY_TASK_TITLES.length)
    expect(rows.every((r) => r.isDefaultTask === true)).toBe(true)
    expect(rows.every((r) => r.campaignId === 7)).toBe(true)
  })

  // Shares the anchor with its pre-launch siblings and resolves a week past
  // it, which is what puts it at the end of that block rather than off on its
  // own date.
  it('dates the row a week past the shared anchor', () => {
    const rows = buildCampaignStoryTrackerTaskRows(7, anchor, election)
    expect(rows[0]?.date).toEqual(addDays(startOfDay(anchor), 7))
  })

  it('sits in pre-launch and carries its own link and CTA', () => {
    const rows = buildCampaignStoryTrackerTaskRows(7, anchor, election)
    expect(rows[0]?.phase).toBe('preLaunch')
    expect(rows[0]?.link).toBe('/dashboard?personalize=1')
    expect(rows[0]?.cta).toBe('Add your story')
  })

  // The two catalog rows that close out pre-launch share this date, so the
  // story row lands with them rather than ahead of the whole block.
  it('lands no earlier than the rest of the pre-launch block', () => {
    const [story] = buildCampaignStoryTrackerTaskRows(7, anchor, election)
    const preLaunch = buildStaticTrackerTaskRows(7, anchor, election, true)
      .filter((row) => row.phase === 'preLaunch')
      .map((row) => row.date as Date)
    expect(story?.date).toEqual(
      preLaunch.reduce((max, d) => (d > max ? d : max), preLaunch[0] as Date),
    )
  })

  // flowType drives the voter-contact count modal; the story task is not
  // outreach, so it must stay null and complete as a plain toggle.
  it('has no flow type', () => {
    const rows = buildCampaignStoryTrackerTaskRows(7, anchor, election)
    expect(rows[0]?.flowType).toBeNull()
  })
})

describe('tracker row dates', () => {
  // Every tracker date is a naive calendar day stored at UTC midnight. A local
  // start-of-day put it at the previous evening on a server west of UTC, so a
  // send due Oct 8 read Oct 7.
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles'
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('stores every date at UTC midnight, whatever the server timezone', () => {
    const rows = [
      ...buildStaticTrackerTaskRows(
        1,
        new Date('2026-10-05T00:00:00.000Z'),
        new Date('2026-11-26T00:00:00.000Z'),
        true,
      ),
      ...buildOutreachTrackerTaskRows(
        1,
        new Date('2026-10-05T00:00:00.000Z'),
        new Date('2026-11-26T00:00:00.000Z'),
        false,
      ),
    ]
    for (const row of rows) {
      expect(new Date(row.date).toISOString()).toMatch(/T00:00:00\.000Z$/)
    }
    const robocall = rows.find((row) => row.title === 'Introduction Robocall')
    expect(new Date(robocall?.date ?? 0).toISOString().slice(0, 10)).toBe(
      '2026-10-08',
    )
  })
})
