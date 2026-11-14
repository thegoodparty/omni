import { describe, expect, it } from 'vitest'
import type { RunView } from '@/agents/types'
import { killTestVerdict, readyToKill } from './killTestVerdict'

const view = (
  overrides: Partial<RunView>,
  stages: Array<[string, string, number]>,
): RunView => ({
  runId: 'run-1',
  agent: 'meetingBriefing',
  status: 'running',
  shapeHash: 'hash-a',
  stages: stages.map(([name, status, steps]) => ({ name, status, steps })),
  ...overrides,
})

const before = view({}, [
  ['findAgenda', 'completed', 9],
  ['readPacket', 'running', 3],
  ['writeBriefing', 'pending', 0],
])

describe('readyToKill', () => {
  it('waits until readPacket has saved enough steps', () => {
    expect(readyToKill(before, 3)).toBe(true)
    expect(readyToKill(before, 4)).toBe(false)
    expect(
      readyToKill(
        view({}, [
          ['findAgenda', 'running', 4],
          ['readPacket', 'pending', 0],
        ]),
        0,
      ),
    ).toBe(false)
  })
})

describe('killTestVerdict', () => {
  it('passes a resume that kept findAgenda and readPacket progress', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({}, [
        ['findAgenda', 'completed', 9],
        ['readPacket', 'running', 4],
      ]),
      final: view({ status: 'completed' }, [['findAgenda', 'completed', 9]]),
      changedShape: false,
    })
    expect(verdict).toMatchObject({ outcome: 'resumed', pass: true })
  })

  it('fails a run that started over when nothing changed', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({}, [
        ['findAgenda', 'running', 1],
        ['readPacket', 'pending', 0],
      ]),
      final: view({ status: 'completed' }, []),
      changedShape: false,
    })
    expect(verdict.pass).toBe(false)
  })

  it('passes a start-over under a new shape hash after a shape change', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({ shapeHash: 'hash-b' }, [
        ['findAgenda', 'running', 1],
        ['readPacket', 'pending', 0],
      ]),
      final: view({ status: 'completed', shapeHash: 'hash-b' }, []),
      changedShape: true,
    })
    expect(verdict).toMatchObject({ outcome: 'started_over', pass: true })
  })

  it('fails a shape change that resumed anyway', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: view({}, [
        ['findAgenda', 'completed', 9],
        ['readPacket', 'running', 4],
      ]),
      final: view({ status: 'completed' }, []),
      changedShape: true,
    })
    expect(verdict).toMatchObject({ outcome: 'resumed', pass: false })
  })

  it('fails a run that did not complete', () => {
    const verdict = killTestVerdict({
      before,
      firstAfter: before,
      final: view({ status: 'failed' }, []),
      changedShape: false,
    })
    expect(verdict.pass).toBe(false)
  })
})
