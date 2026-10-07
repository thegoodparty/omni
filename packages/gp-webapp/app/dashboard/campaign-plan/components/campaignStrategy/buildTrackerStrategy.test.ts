import { describe, expect, it } from 'vitest'
import { startOfDay } from 'date-fns'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import {
  buildTrackerStrategy,
  followingWeekStart,
} from './buildTrackerStrategy'

const row = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: 'x',
  title: 'T',
  description: 'D',
  cta: null,
  link: null,
  flowType: null,
  week: 0,
  date: '2026-02-01',
  completed: false,
  phase: 'preLaunch',
  proRequired: null,
  isDefaultTask: false,
  ...over,
})

describe('buildTrackerStrategy', () => {
  const today = startOfDay(new Date('2026-01-15'))

  it('folds pre-launch work into Launch and carries completed through', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'preLaunch', completed: true }),
        row({ id: 'b', phase: 'launch' }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.map((p) => p.key)).toEqual(['launch', 'active', 'gotv'])
    const launch = data.phases.find((p) => p.key === 'launch')
    const tasks = launch?.groups.flatMap((g) => g.tasks) ?? []
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(tasks.find((t) => t.id === 'a')?.completed).toBe(true)
  })

  it('hides GOTV behind a window banner when >30 days out', () => {
    const election = startOfDay(new Date('2026-11-03'))
    const data = buildTrackerStrategy([row({ phase: 'gotv' })], {
      electionDate: election,
      today,
    })
    const gotv = data.phases.find((p) => p.key === 'gotv')
    expect(gotv?.gate?.kind).toBe('window')
    expect(gotv?.groups).toHaveLength(0)
  })

  it('shows every task in an active week at once, nothing withheld', () => {
    // All six land in the same Mon-Sun week (Feb 2-8), so they share one week.
    const active = Array.from({ length: 6 }, (_, i) =>
      row({ id: `t${i}`, phase: 'active', date: `2026-02-0${i + 2}` }),
    )
    const data = buildTrackerStrategy(active, { electionDate: null, today })
    const phase = data.phases.find((p) => p.key === 'active')
    expect(phase?.weeks).toHaveLength(1)
    expect(phase?.weeks?.flatMap((w) => w.tasks)).toHaveLength(6)
  })

  it('withholds nothing for the static launch checklist', () => {
    const pre = Array.from({ length: 6 }, (_, i) =>
      row({ id: `p${i}`, phase: 'preLaunch', date: `2026-02-0${i + 1}` }),
    )
    const data = buildTrackerStrategy(pre, { electionDate: null, today })
    const phase = data.phases.find((p) => p.key === 'launch')
    expect(phase?.groups.flatMap((g) => g.tasks)).toHaveLength(6)
  })

  it('splits active tasks into Mon-Sun weeks and flags the current one', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'active', date: '2026-01-14' }),
        row({ id: 'b', phase: 'active', date: '2026-01-21' }),
      ],
      { electionDate: null, today },
    )
    const weeks = data.phases.find((p) => p.key === 'active')?.weeks ?? []
    expect(weeks.map((w) => w.start)).toEqual(['2026-01-12', '2026-01-19'])
    expect(weeks[0]?.isCurrent).toBe(true)
    expect(weeks[1]?.isCurrent).toBe(false)
    expect(weeks[0]?.tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('within an active week keeps the latest generation; static rows stay', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'old', phase: 'active', week: 1, date: '2026-02-03' }),
        row({ id: 'new', phase: 'active', week: 2, date: '2026-02-04' }),
        row({
          id: 'static',
          phase: 'preLaunch',
          week: 5,
          isDefaultTask: true,
          date: '2026-01-01',
        }),
      ],
      // The timeline starts Jan 1, and an April election opens the active
      // campaign at the end of January, so the February rows are active.
      { electionDate: startOfDay(new Date('2026-04-10')), today },
    )
    const active = data.phases
      .find((p) => p.key === 'active')
      ?.weeks?.flatMap((w) => w.tasks)
      .map((t) => t.id)
    expect(active).toEqual(['new'])
    const launch = data.phases
      .find((p) => p.key === 'launch')
      ?.groups.flatMap((g) => g.tasks)
      .map((t) => t.id)
    expect(launch).toEqual(['static'])
  })

  it('keeps Active "active" when a prior-generation navigable task is open', () => {
    // gen-6 (the global latest) is all done, but gen-5 in an earlier week is
    // still open and reachable in the navigator. The phase must not read 'done'.
    const data = buildTrackerStrategy(
      [
        row({ id: 'g5', phase: 'active', week: 5, date: '2026-02-03' }),
        row({
          id: 'g6',
          phase: 'active',
          week: 6,
          date: '2026-02-10',
          completed: true,
        }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
  })

  it('marks a phase done only when all its tasks are completed', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'launch', completed: true }),
        row({ id: 'b', phase: 'active', completed: false }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'launch')?.status).toBe('done')
    expect(data.phases.find((p) => p.key === 'active')?.status).not.toBe('done')
  })

  it('leaves text/robocall rows without an href (the row opens the flow in place)', () => {
    const data = buildTrackerStrategy(
      [
        row({
          id: 't',
          phase: 'launch',
          flowType: 'text',
          date: '2026-02-03T00:00:00.000Z',
        }),
        row({ id: 'r', phase: 'launch', flowType: 'robocall' }),
      ],
      { electionDate: null, today },
    )
    const tasks = data.phases.flatMap((p) => p.groups).flatMap((g) => g.tasks)
    const byId = new Map(tasks.map((t) => [t.id, t]))
    expect(byId.get('t')?.href).toBeNull()
    expect(byId.get('t')?.channel).toBe('text')
    expect(byId.get('r')?.channel).toBe('robocall')
  })

  it('advances to the active campaign when every Launch task is done', () => {
    // Launch is the calendar-current phase (future date) but fully checked
    // off; the active campaign must become current instead of stranding at
    // 'upcoming'.
    const data = buildTrackerStrategy(
      [
        row({
          id: 'a',
          phase: 'launch',
          date: '2026-02-01',
          completed: true,
        }),
        row({ id: 'b', phase: 'active', date: '2026-03-01' }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'launch')?.status).toBe('done')
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
  })

  it('advances past an empty intermediate phase when the prior phase is done', () => {
    const data = buildTrackerStrategy(
      [
        row({
          id: 'a',
          phase: 'preLaunch',
          date: '2026-02-01',
          completed: true,
        }),
        row({ id: 'b', phase: 'active', date: '2026-04-01' }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'launch')?.status).not.toBe(
      'active',
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
  })

  it('does not advance into GOTV while a prior-generation Active task is open', () => {
    // Active's latest generation (week 6) is fully done, but week 5 still has
    // an open, navigator-reachable task. The completion advance must treat
    // Active as open — not walk into GOTV.
    const data = buildTrackerStrategy(
      [
        row({
          id: 'pre',
          phase: 'preLaunch',
          date: '2026-01-02',
          completed: true,
        }),
        row({ id: 'g5', phase: 'active', week: 5, date: '2026-01-06' }),
        row({
          id: 'g6',
          phase: 'active',
          week: 6,
          date: '2026-01-13',
          completed: true,
        }),
        row({ id: 'gotv', phase: 'gotv', date: '2026-03-01' }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
    expect(data.phases.find((p) => p.key === 'gotv')?.status).toBe('upcoming')
  })

  it('keeps "happening now" date-based: a date-past phase with open tasks is not upcoming', () => {
    // today is 2026-01-15; Launch dated in the past, active in the future.
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'launch', date: '2026-01-01' }),
        row({ id: 'b', phase: 'active', date: '2026-02-01' }),
      ],
      { electionDate: null, today },
    )
    // Not all completed, and the calendar has reached/passed it → active.
    expect(data.phases.find((p) => p.key === 'launch')?.status).toBe('active')
  })

  it('marks a populated phase active even when earlier phases are empty', () => {
    // Only Active has rows (e.g. right after bootstrap, before other phases
    // populate). An empty Launch must not strand Active as upcoming.
    const data = buildTrackerStrategy(
      [row({ id: 'a', phase: 'active', date: '2026-02-01' })],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
  })
})

// The story task is a default row the catalog files as pre-launch work, so on
// the timeline it lands early in Launch.
describe('buildTrackerStrategy with the campaign story task', () => {
  const today = startOfDay(new Date('2026-06-10'))
  const storyRow = (over: Partial<CampaignTrackerTask> = {}) =>
    row({
      id: 'story',
      title: 'Tell us your campaign story',
      phase: 'preLaunch',
      date: '2026-06-15',
      isDefaultTask: true,
      link: '/dashboard?personalize=1',
      cta: 'Add your story',
      ...over,
    })

  it('renders in Launch', () => {
    const data = buildTrackerStrategy([storyRow()], {
      electionDate: null,
      today,
    })
    const launch = data.phases.find((p) => p.key === 'launch')
    const ids = launch?.groups.flatMap((g) => g.tasks.map((t) => t.id)) ?? []
    expect(ids).toContain('story')
  })

  // The tracker used to hardcode "Open" for any row with a link, so the story
  // task's own CTA never reached the screen and the rail disagreed with the
  // card above it.
  it('labels the link with the row own CTA', () => {
    const data = buildTrackerStrategy([storyRow()], {
      electionDate: null,
      today,
    })
    const tasks =
      data.phases
        .find((p) => p.key === 'launch')
        ?.groups.flatMap((g) => g.tasks) ?? []
    expect(tasks.find((t) => t.id === 'story')?.hrefLabel).toBe(
      'Add your story',
    )
  })

  it('falls back to Open for a row with a link and no CTA', () => {
    const data = buildTrackerStrategy([storyRow({ cta: null })], {
      electionDate: null,
      today,
    })
    const tasks =
      data.phases
        .find((p) => p.key === 'launch')
        ?.groups.flatMap((g) => g.tasks) ?? []
    expect(tasks.find((t) => t.id === 'story')?.hrefLabel).toBe('Open')
  })

  it('reads as done once the story is complete and the row is ticked', () => {
    const data = buildTrackerStrategy([storyRow({ completed: true })], {
      electionDate: null,
      today,
    })
    const tasks =
      data.phases
        .find((p) => p.key === 'launch')
        ?.groups.flatMap((g) => g.tasks) ?? []
    expect(tasks.find((t) => t.id === 'story')?.completed).toBe(true)
  })

  // A task's phase is the window its date falls in. With the election in
  // November the active campaign opens in late August, so June's work, the
  // weekly tasks included, is Launch work, and the rail says so.
  it('places work by its date, so June is still Launch for a November race', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'old-pre', phase: 'preLaunch', date: '2026-01-05' }),
        row({ id: 'this-week', phase: 'active', date: '2026-06-11' }),
        storyRow(),
      ],
      { electionDate: startOfDay(new Date('2026-11-03')), today },
    )
    const launchIds =
      data.phases
        .find((p) => p.key === 'launch')
        ?.groups.flatMap((g) => g.tasks.map((t) => t.id)) ?? []
    expect(launchIds).toEqual(
      expect.arrayContaining(['old-pre', 'this-week', 'story']),
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('upcoming')
  })
})

describe('buildTrackerStrategy head start', () => {
  // A Thursday: this week starts 2026-01-12, next week 2026-01-19.
  const today = startOfDay(new Date('2026-01-15'))
  const nextIds = (data: ReturnType<typeof buildTrackerStrategy>) =>
    data.phases
      .flatMap((p) => p.weeks ?? [])
      .flatMap((w) => w.tasks)
      .filter((t) => t.isNext)
      .map((t) => t.id)
  const rows = (thisWeekDone: boolean) => [
    row({
      id: 'this',
      phase: 'active',
      date: '2026-01-13',
      completed: thisWeekDone,
    }),
    row({ id: 'next-a', phase: 'active', date: '2026-01-20' }),
    row({ id: 'next-b', phase: 'active', date: '2026-01-21' }),
  ]

  it('names next week as the one to pull forward', () => {
    expect(followingWeekStart(today)).toBe('2026-01-19')
  })

  it('leaves no next task once the week is done, until asked', () => {
    const data = buildTrackerStrategy(rows(true), {
      electionDate: null,
      today,
    })
    expect(nextIds(data)).toEqual([])
  })

  it('makes next week’s first open task the next one on a head start', () => {
    const data = buildTrackerStrategy(rows(true), {
      electionDate: null,
      today,
      headStartWeek: '2026-01-19',
    })
    expect(nextIds(data)).toEqual(['next-a'])
  })

  it('keeps this week’s open task first, head start or not', () => {
    const data = buildTrackerStrategy(rows(false), {
      electionDate: null,
      today,
      headStartWeek: '2026-01-19',
    })
    expect(nextIds(data)).toEqual(['this'])
  })

  it('ignores a head start for any week but next week', () => {
    const data = buildTrackerStrategy(rows(true), {
      electionDate: null,
      today,
      headStartWeek: '2026-01-12',
    })
    expect(nextIds(data)).toEqual([])
  })
})

describe('buildTrackerStrategy with tasks set aside', () => {
  const today = startOfDay(new Date('2026-01-15'))
  const nextIds = (data: ReturnType<typeof buildTrackerStrategy>) =>
    data.phases
      .flatMap((p) => [
        ...p.groups.flatMap((g) => g.tasks),
        ...(p.weeks ?? []).flatMap((w) => w.tasks),
      ])
      .filter((t) => t.isNext)
      .map((t) => t.id)

  it('passes over a not-for-me task when picking the next one', () => {
    const data = buildTrackerStrategy(
      [
        row({
          id: 'dropped',
          phase: 'active',
          date: '2026-01-13',
          skipReason: 'notForMe',
        }),
        row({ id: 'open', phase: 'active', date: '2026-01-16' }),
      ],
      { electionDate: null, today },
    )
    expect(nextIds(data)).toEqual(['open'])
  })

  it('treats a put-off task as its new date, behind what is due sooner', () => {
    // Put off on Jan 15, it moved to Jan 18, after the open Jan 16 task.
    const data = buildTrackerStrategy(
      [
        row({
          id: 'put-off',
          phase: 'active',
          date: '2026-01-18',
          skipReason: 'later',
        }),
        row({ id: 'open', phase: 'active', date: '2026-01-16' }),
      ],
      { electionDate: null, today },
    )
    expect(nextIds(data)).toEqual(['open'])
    const putOff = data.phases
      .flatMap((p) => p.weeks ?? [])
      .flatMap((w) => w.tasks)
      .find((t) => t.id === 'put-off')
    expect(putOff?.setAside).toBeNull()
  })
})
