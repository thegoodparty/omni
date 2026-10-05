import { describe, expect, it } from 'vitest'
import {
  type NextTrackerTaskCandidate,
  selectNextTrackerTask,
} from './NextTrackerTask'

const NOW = new Date(2026, 9, 5, 12)
const FAR_ELECTION = new Date(2026, 11, 1)

const task = (
  overrides: Partial<NextTrackerTaskCandidate> & { id: string },
): NextTrackerTaskCandidate => ({
  title: `Task ${overrides.id}`,
  phase: 'launch',
  date: '2026-10-10T00:00:00.000Z',
  completed: false,
  flowType: null,
  isDefaultTask: true,
  week: 0,
  skipReason: null,
  snoozedUntil: null,
  ...overrides,
})

const pick = (
  tasks: NextTrackerTaskCandidate[],
  overrides: { onBallot?: boolean; electionDate?: Date | null } = {},
) =>
  selectNextTrackerTask(tasks, {
    onBallot: overrides.onBallot ?? true,
    electionDate:
      overrides.electionDate === undefined
        ? FAR_ELECTION
        : overrides.electionDate,
    now: NOW,
  })?.id ?? null

describe('selectNextTrackerTask', () => {
  it('picks the earliest open task in plan order: phase, then date', () => {
    expect(
      pick([
        task({ id: 'launch-early', phase: 'launch', date: '2026-10-06' }),
        task({ id: 'pre-late', phase: 'preLaunch', date: '2026-11-01' }),
        task({ id: 'pre-early', phase: 'preLaunch', date: '2026-10-20' }),
      ]),
    ).toBe('pre-early')
  })

  it('returns null when nothing is left to do', () => {
    expect(pick([task({ id: 'done', completed: true })])).toBeNull()
  })

  it('passes over done and "not for me" tasks', () => {
    expect(
      pick([
        task({ id: 'done', date: '2026-10-06', completed: true }),
        task({ id: 'dismissed', date: '2026-10-07', skipReason: 'notForMe' }),
        task({ id: 'open', date: '2026-10-08' }),
      ]),
    ).toBe('open')
  })

  it('passes over a "later" task until its snooze runs out', () => {
    const snoozed = task({
      id: 'snoozed',
      date: '2026-10-06',
      skipReason: 'later',
      snoozedUntil: new Date(2026, 9, 8),
    })
    const open = task({ id: 'open', date: '2026-10-08' })
    expect(pick([snoozed, open])).toBe('open')

    const woken = { ...snoozed, snoozedUntil: new Date(2026, 9, 5, 9) }
    expect(pick([woken, open])).toBe('snoozed')
  })

  it('keeps an overdue task, but drops a missed event or send', () => {
    expect(
      pick([
        task({ id: 'missed-event', date: '2026-10-01', flowType: 'events' }),
        task({ id: 'missed-text', date: '2026-10-02', flowType: 'text' }),
        task({ id: 'overdue-setup', date: '2026-10-03', flowType: null }),
      ]),
    ).toBe('overdue-setup')
  })

  it('keeps a time-bound task on its own date', () => {
    expect(
      pick([task({ id: 'today', date: '2026-10-05', flowType: 'events' })]),
    ).toBe('today')
  })

  it('holds get-out-the-vote work until the final 30 days', () => {
    const gotv = task({ id: 'gotv', phase: 'gotv', date: '2026-10-30' })
    expect(pick([gotv])).toBeNull()
    expect(pick([gotv], { electionDate: null })).toBeNull()
    expect(pick([gotv], { electionDate: new Date(2026, 10, 1) })).toBe('gotv')
  })

  it('puts ballot access first for a candidate who is not on the ballot', () => {
    const tasks = [
      task({ id: 'story', phase: 'preLaunch', date: '2026-10-06' }),
      task({
        id: 'ballot',
        phase: 'preLaunch',
        date: '2026-11-15',
        title: 'Submit your Ballot Access Signatures',
      }),
    ]
    expect(pick(tasks, { onBallot: false })).toBe('ballot')
    expect(pick(tasks, { onBallot: true })).toBe('story')
  })

  it('only considers the latest generation of AI-picked tasks', () => {
    expect(
      pick([
        task({
          id: 'old-gen',
          isDefaultTask: false,
          week: 1,
          date: '2026-10-06',
        }),
        task({
          id: 'new-gen',
          isDefaultTask: false,
          week: 2,
          date: '2026-10-09',
        }),
      ]),
    ).toBe('new-gen')
  })

  it('treats an unknown phase as pre-launch, matching the plan', () => {
    expect(
      pick([
        task({ id: 'launch', phase: 'launch', date: '2026-10-06' }),
        task({ id: 'unknown', phase: null, date: '2026-10-20' }),
      ]),
    ).toBe('unknown')
  })
})
