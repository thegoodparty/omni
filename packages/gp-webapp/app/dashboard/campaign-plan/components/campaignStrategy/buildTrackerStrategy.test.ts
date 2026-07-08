import { describe, expect, it } from 'vitest'
import { startOfDay } from 'date-fns'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { buildTrackerStrategy } from './buildTrackerStrategy'

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

  it('buckets rows by phase and carries completed through', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'preLaunch', completed: true }),
        row({ id: 'b', phase: 'launch' }),
      ],
      { electionDate: null, today },
    )
    const pre = data.phases.find((p) => p.key === 'preLaunch')
    const tasks = pre?.groups.flatMap((g) => g.tasks) ?? []
    expect(tasks.map((t) => t.id)).toContain('a')
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
    const phase = data.phases.find((p) => p.key === 'preLaunch')
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
        row({ id: 'static', phase: 'preLaunch', week: 5, isDefaultTask: true }),
      ],
      { electionDate: null, today },
    )
    const active = data.phases
      .find((p) => p.key === 'active')
      ?.weeks?.flatMap((w) => w.tasks)
      .map((t) => t.id)
    expect(active).toEqual(['new'])
    const pre = data.phases
      .find((p) => p.key === 'preLaunch')
      ?.groups.flatMap((g) => g.tasks)
      .map((t) => t.id)
    expect(pre).toEqual(['static'])
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
        row({ id: 'a', phase: 'preLaunch', completed: true }),
        row({ id: 'b', phase: 'launch', completed: false }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'preLaunch')?.status).toBe('done')
    expect(data.phases.find((p) => p.key === 'launch')?.status).not.toBe('done')
  })

  it('links text/robocall rows to the outreach compose flow with the due date', () => {
    const data = buildTrackerStrategy(
      [
        row({
          id: 't',
          phase: 'launch',
          flowType: 'text',
          date: '2026-02-03T00:00:00.000Z',
        }),
        row({ id: 'r', phase: 'launch', flowType: 'robocall' }),
        row({ id: 'd', phase: 'launch', flowType: 'doorKnocking' }),
      ],
      { electionDate: null, today },
    )
    const tasks = data.phases.flatMap((p) => p.groups).flatMap((g) => g.tasks)
    const byId = new Map(tasks.map((t) => [t.id, t]))
    expect(byId.get('t')?.href).toBe(
      '/dashboard/outreach?compose=text&due=2026-02-03',
    )
    expect(byId.get('t')?.hrefLabel).toBe('Start outreach')
    expect(byId.get('r')?.href).toBe(
      '/dashboard/outreach?compose=robocall&due=2026-02-01',
    )
    expect(byId.get('d')?.href).toBeNull()
  })

  it('advances Launch to active when every pre-launch task is done', () => {
    // preLaunch is the calendar-current phase (future date) but fully checked
    // off; Launch must become the current phase instead of stranding at
    // 'upcoming' (bug-bash finding: "pre-launch Done, launch stays Coming Up").
    const data = buildTrackerStrategy(
      [
        row({
          id: 'a',
          phase: 'preLaunch',
          date: '2026-02-01',
          completed: true,
        }),
        row({ id: 'b', phase: 'launch', date: '2026-03-01' }),
      ],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'preLaunch')?.status).toBe('done')
    expect(data.phases.find((p) => p.key === 'launch')?.status).toBe('active')
  })

  it('keeps "happening now" date-based: a date-past phase with open tasks is not upcoming', () => {
    // today is 2026-01-15; preLaunch dated in the past, launch in the future.
    const data = buildTrackerStrategy(
      [
        row({ id: 'a', phase: 'preLaunch', date: '2026-01-01' }),
        row({ id: 'b', phase: 'launch', date: '2026-02-01' }),
      ],
      { electionDate: null, today },
    )
    // Not all completed, and the calendar has reached/passed it → active.
    expect(data.phases.find((p) => p.key === 'preLaunch')?.status).toBe(
      'active',
    )
  })

  it('marks a populated phase active even when earlier phases are empty', () => {
    // Only Active has rows (e.g. right after bootstrap, before other phases
    // populate). The empty preLaunch/launch must not strand Active as upcoming.
    const data = buildTrackerStrategy(
      [row({ id: 'a', phase: 'active', date: '2026-02-01' })],
      { electionDate: null, today },
    )
    expect(data.phases.find((p) => p.key === 'active')?.status).toBe('active')
  })
})
