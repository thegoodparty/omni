import type Anthropic from '@anthropic-ai/sdk'
import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadReplay, runReplay } from './replay.js'

/**
 * Regression tests for failure isolation.
 *
 * A sonnet-vs-haiku comparison produced all twelve agent runs and then lost every
 * verdict to one timed-out judge call, because a single rejection aborted the whole
 * batch. $16.90 of agent spend came back with an empty table. These pin the fix.
 */

const okBlock = (winner: string) => ({
  content: [
    {
      type: 'tool_use',
      input: {
        winner,
        margin: winner === 'tie' ? 'tie' : 'better',
        deciding_criterion: 'specificity',
        rationale: 'a reason',
      },
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: 'tool_use',
})

/** Fails the nth call (0-indexed), succeeds otherwise. */
const clientFailingOn = (failAt: number[]) => {
  let call = -1
  return {
    messages: {
      create: async () => {
        call += 1
        if (failAt.includes(call)) throw new Error('Request timed out')
        return okBlock('output_1')
      },
    },
  } as unknown as Anthropic
}

const replayFile = (caseIds: string[]) => ({
  agent: 'find_existing_ordinances',
  pairs: caseIds.map((id) => ({
    caseId: id,
    input: { state: 'PA' },
    baseline: { a: 1 },
    candidate: { b: 2 },
    baselineCostUsd: 2,
    candidateCostUsd: 1,
  })),
})

describe('runReplay failure isolation', () => {
  it('keeps the verdicts it earned when one pair fails', async () => {
    // Six pairs, two judge calls each. Fail the first pair's first call only.
    const result = await runReplay({
      replay: replayFile(['a', 'b', 'c', 'd', 'e', 'f']),
      client: clientFailingOn([0]),
    })
    expect(result.verdicts).toHaveLength(5)
    expect(result.verdicts.map((v) => v.caseId)).not.toContain('a')
  })

  it('names the failed case and the reason in the notes', async () => {
    const result = await runReplay({
      replay: replayFile(['a', 'b']),
      client: clientFailingOn([0]),
    })
    const notes = result.notes.join(' ')
    expect(notes).toMatch(/judge failed on 1 case/)
    expect(notes).toContain('a (')
    expect(notes).toContain('Request timed out')
  })

  it('still reports both sides of a failed pair as produced runs', async () => {
    // The agent runs happened and were paid for even when judging them failed.
    const result = await runReplay({
      replay: replayFile(['a', 'b']),
      client: clientFailingOn([0]),
    })
    expect(result.runs).toHaveLength(4)
    expect(result.runs.every((r) => r.status === 'ok')).toBe(true)
  })

  it('survives every pair failing without throwing', async () => {
    const result = await runReplay({
      replay: replayFile(['a', 'b']),
      client: clientFailingOn([0, 1, 2, 3]),
    })
    expect(result.verdicts).toHaveLength(0)
    expect(result.runs).toHaveLength(4)
  })

  it('carries stored costs through so the table is populated', async () => {
    const result = await runReplay({
      replay: replayFile(['a']),
      client: clientFailingOn([]),
    })
    const baseline = result.runs.find((r) => r.variant === 'baseline')
    const candidate = result.runs.find((r) => r.variant === 'candidate')
    expect(baseline!.costUsd).toBe(2)
    expect(candidate!.costUsd).toBe(1)
  })
})

describe('loadReplay', () => {
  it('rejects a file with no pairs rather than reporting an empty comparison', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uj-replay-'))
    const path = join(dir, 'replay.json')
    writeFileSync(path, JSON.stringify({ agent: 'x', pairs: [] }))
    expect(() => loadReplay(path)).toThrow()
  })

  it('round-trips a well-formed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uj-replay-'))
    const path = join(dir, 'replay.json')
    writeFileSync(path, JSON.stringify(replayFile(['a'])))
    expect(loadReplay(path).pairs).toHaveLength(1)
  })
})
