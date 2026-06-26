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

  it('caps active to the weekly limit of 3', () => {
    const active = Array.from({ length: 6 }, (_, i) =>
      row({ id: `t${i}`, phase: 'active', date: `2026-02-0${i + 1}` }),
    )
    const data = buildTrackerStrategy(active, { electionDate: null, today })
    const shown = data.phases
      .find((p) => p.key === 'active')
      ?.groups.flatMap((g) => g.tasks)
    expect(shown).toHaveLength(3)
  })

  it('reveals an extra active task per completed one', () => {
    const active = [
      row({ id: 't0', phase: 'active', date: '2026-02-01', completed: true }),
      ...Array.from({ length: 5 }, (_, i) =>
        row({ id: `t${i + 1}`, phase: 'active', date: `2026-02-0${i + 2}` }),
      ),
    ]
    const data = buildTrackerStrategy(active, { electionDate: null, today })
    const shown = data.phases
      .find((p) => p.key === 'active')
      ?.groups.flatMap((g) => g.tasks)
    expect(shown).toHaveLength(4)
  })

  it('reports the withheld count so the UI can say more will unlock', () => {
    const active = Array.from({ length: 6 }, (_, i) =>
      row({ id: `t${i}`, phase: 'active', date: `2026-02-0${i + 1}` }),
    )
    const data = buildTrackerStrategy(active, { electionDate: null, today })
    const phase = data.phases.find((p) => p.key === 'active')
    expect(phase?.groups.flatMap((g) => g.tasks)).toHaveLength(3)
    expect(phase?.hiddenCount).toBe(3)
  })

  it('withholds nothing for the static launch checklist', () => {
    const pre = Array.from({ length: 6 }, (_, i) =>
      row({ id: `p${i}`, phase: 'preLaunch', date: `2026-02-0${i + 1}` }),
    )
    const data = buildTrackerStrategy(pre, { electionDate: null, today })
    const phase = data.phases.find((p) => p.key === 'preLaunch')
    expect(phase?.groups.flatMap((g) => g.tasks)).toHaveLength(6)
    expect(phase?.hiddenCount ?? 0).toBe(0)
  })

  it('renders only the latest dynamic generation, keeping static rows', () => {
    const data = buildTrackerStrategy(
      [
        row({ id: 'old', phase: 'active', week: 1, date: '2026-02-01' }),
        row({ id: 'new', phase: 'active', week: 2, date: '2026-02-08' }),
        row({ id: 'static', phase: 'preLaunch', week: 5, isDefaultTask: true }),
      ],
      { electionDate: null, today },
    )
    const active = data.phases
      .find((p) => p.key === 'active')
      ?.groups.flatMap((g) => g.tasks)
      .map((t) => t.id)
    expect(active).toEqual(['new'])
    const pre = data.phases
      .find((p) => p.key === 'preLaunch')
      ?.groups.flatMap((g) => g.tasks)
      .map((t) => t.id)
    expect(pre).toEqual(['static'])
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
