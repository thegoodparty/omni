import { describe, expect, it } from 'vitest'
import type { RunView } from '@/agents/types'
import { killTestVerdict, readyToKill } from './killTestVerdict'

const view = (overrides: Partial<RunView>): RunView => ({
  runId: 'run-1',
  agent: 'meetingBriefing',
  status: 'running',
  shapeHash: 'hash-a',
  steps: 4,
  ...overrides,
})

const before = view({})

describe('readyToKill', () => {
  it('waits until the run has saved enough steps', () => {
    expect(readyToKill(before, 4)).toBe(true)
    expect(readyToKill(before, 5)).toBe(false)
    expect(readyToKill(view({ status: 'queued', steps: 0 }), 0)).toBe(false)
  })
})

describe('killTestVerdict', () => {
  it('passes a resume that kept the saved steps', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({ steps: 5 }),
      final: view({ status: 'completed', steps: 12 }),
      changedShape: false,
    })
    expect(verdict).toMatchObject({ outcome: 'resumed', pass: true })
  })

  it('fails a run that started over when nothing changed', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({ status: 'superseded', supersededBy: 'run-2' }),
      final: view({ runId: 'run-2', status: 'completed' }),
      changedShape: false,
    })
    expect(verdict.pass).toBe(false)
  })

  it('passes a fresh run under a new shape hash after a shape change', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({ status: 'superseded', supersededBy: 'run-2' }),
      final: view({
        runId: 'run-2',
        status: 'completed',
        shapeHash: 'hash-b',
        steps: 10,
      }),
      changedShape: true,
    })
    expect(verdict).toMatchObject({ outcome: 'started_over', pass: true })
  })

  it('fails a shape change that resumed anyway', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({ steps: 5 }),
      final: view({ status: 'completed' }),
      changedShape: true,
    })
    expect(verdict).toMatchObject({ outcome: 'resumed', pass: false })
  })

  it('fails a run that did not complete', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: before,
      final: view({ status: 'failed' }),
      changedShape: false,
    })
    expect(verdict.pass).toBe(false)
  })
})
