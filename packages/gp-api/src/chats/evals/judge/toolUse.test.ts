import { describe, expect, it } from 'vitest'
import { CHAT_PAIR } from './fixtures/records'
import type { RunRecord, TraceStep } from './record'
import { chatToolUse } from './toolUse'

const [BASE, CANDIDATE] = CHAT_PAIR

const run = (
  from: RunRecord,
  caseId: string,
  attempt: number,
  trace: TraceStep[],
  status: RunRecord['status'] = 'produced',
): RunRecord => ({
  ...from,
  caseId,
  attempt,
  runId: `${caseId}:${from.arm}:${attempt}`,
  trace,
  status,
  ...(status === 'infraError' && { output: null }),
})

const tool = (index: number, name: string, error?: string): TraceStep => ({
  index,
  kind: 'tool',
  tool: name,
  ...(error !== undefined && { error }),
})

describe('chatToolUse', () => {
  it('counts each tool once per run, and a run as errored if any call failed', () => {
    const [agent] = chatToolUse(
      ['chief_of_staff'],
      [
        run(CANDIDATE, 'hearing', 1, [
          tool(0, 'count_contacts', 'timeout'),
          tool(1, 'count_contacts'),
          tool(2, 'present_outreach_proposal'),
        ]),
        run(CANDIDATE, 'hearing', 2, [tool(0, 'present_outreach_proposal')]),
        run(CANDIDATE, 'hearing', 3, [
          { index: 0, kind: 'text' },
          tool(1, 'present_outreach_proposal'),
          tool(2, 'count_contacts'),
        ]),
        run(BASE, 'hearing', 1, [{ index: 0, kind: 'text' }]),
      ],
    )
    expect(agent?.cases).toEqual([
      {
        caseId: 'hearing',
        base: { runs: 1, infraErrors: 0, tools: {} },
        candidate: {
          runs: 3,
          infraErrors: 0,
          tools: {
            count_contacts: { called: 2, errored: 1 },
            present_outreach_proposal: { called: 3, errored: 0 },
          },
        },
      },
    ])
  })

  it('leaves infraError runs out of the runs and counts them apart', () => {
    const [agent] = chatToolUse(
      ['chief_of_staff'],
      [
        run(BASE, 'a', 1, [tool(0, 'crud_priorities')]),
        run(BASE, 'a', 2, [tool(0, 'crud_priorities')], 'infraError'),
        run(CANDIDATE, 'a', 1, [tool(0, 'crud_priorities')], 'blocked'),
      ],
    )
    expect(agent?.cases[0]?.base).toEqual({
      runs: 1,
      infraErrors: 1,
      tools: { crud_priorities: { called: 1, errored: 0 } },
    })
    expect(agent?.cases[0]?.candidate.runs).toBe(1)
  })

  it('keeps a case only one arm ran, sorted by case id', () => {
    const [agent] = chatToolUse(
      ['chief_of_staff'],
      [
        run(CANDIDATE, 'z-new', 1, [tool(0, 'crud_priorities')]),
        run(BASE, 'a-old', 1, []),
        run(CANDIDATE, 'a-old', 1, []),
      ],
    )
    expect(agent?.cases.map((c) => c.caseId)).toEqual(['a-old', 'z-new'])
    expect(agent?.cases[1]?.base).toEqual({
      runs: 0,
      infraErrors: 0,
      tools: {},
    })
  })

  it('prints a tool name that is not identifier-shaped as unknown', () => {
    const [agent] = chatToolUse(
      ['chief_of_staff'],
      [run(BASE, 'a', 1, [tool(0, 'Jane Doe voter record', 'no such tool')])],
    )
    expect(agent?.cases[0]?.base.tools).toEqual({
      unknown: { called: 1, errored: 1 },
    })
  })

  it('skips background agents and agents with no records', () => {
    const background = {
      ...run(BASE, 'a', 1, [tool(0, 'Bash')]),
      agentId: 'race_opponent_summary',
      agentShape: 'background' as const,
    }
    expect(
      chatToolUse(
        ['race_opponent_summary', 'chief_of_staff', 'priority_flow'],
        [background, run(BASE, 'a', 1, [])],
      ).map((a) => a.agentId),
    ).toEqual(['chief_of_staff'])
  })
})
