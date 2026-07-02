import { describe, expect, it } from 'vitest'
import { parseAgentRun } from './agent-run'

const assistant = (
  ts: string,
  model: string,
  usage: Record<string, unknown>,
  toolUse: { name: string; input: unknown }[] = [],
) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: {
      model,
      usage,
      content: toolUse.map((t) => ({ type: 'tool_use', ...t })),
    },
  })

describe('parseAgentRun', () => {
  it('computes per-turn cost by model family and rolls up totals', () => {
    const session = [
      assistant(
        '2026-07-01T00:00:00.000Z',
        'claude-sonnet-4-6',
        {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 100,
          cache_creation: {
            ephemeral_5m_input_tokens: 40,
            ephemeral_1h_input_tokens: 0,
          },
        },
        [{ name: 'Bash', input: { command: 'ls -la', description: 'list' } }],
      ),
      assistant('2026-07-01T00:00:05.000Z', 'claude-opus-4-7', {
        input_tokens: 0,
        output_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 0,
        },
      }),
      JSON.stringify({ type: 'user', message: { content: 'ignored' } }),
    ].join('\n')

    const milestones = [
      JSON.stringify({ ts: '2026-07-01T00:00:03.000Z', name: 'discovery' }),
    ].join('\n')

    const run = parseAgentRun(session, milestones)

    expect(run.turns).toHaveLength(2)

    // sonnet: 10*3e-6 + 20*15e-6 + 100*0.3e-6 + 40*3.75e-6 = 0.00051
    expect(run.turns[0]!.costUsd).toBeCloseTo(0.00051, 10)
    expect(run.turns[0]!.milestone).toBe('preamble')
    expect(run.turns[0]!.toolCalls).toEqual([
      { name: 'Bash', summary: 'ls -la' },
    ])

    // opus: 100*25e-6 + 1000*0.5e-6 = 0.003
    expect(run.turns[1]!.costUsd).toBeCloseTo(0.003, 10)
    expect(run.turns[1]!.milestone).toBe('discovery')
    expect(run.turns[1]!.isMilestoneStart).toBe(true)
    expect(run.turns[1]!.deltaMs).toBe(5000)

    expect(run.totals.costUsd).toBeCloseTo(0.00051 + 0.003, 10)
    expect(run.totals.turns).toBe(2)
    expect(run.perMilestone.map((m) => m.name)).toEqual([
      'preamble',
      'discovery',
    ])
  })

  it('tolerates absent milestones and malformed lines', () => {
    const session = [
      'not json',
      assistant('2026-07-01T00:00:00.000Z', 'claude-haiku-4-5', {
        input_tokens: 5,
        output_tokens: 5,
      }),
    ].join('\n')

    const run = parseAgentRun(session)
    expect(run.turns).toHaveLength(1)
    expect(run.turns[0]!.milestone).toBe('preamble')
    expect(run.milestones).toHaveLength(0)
  })
})
