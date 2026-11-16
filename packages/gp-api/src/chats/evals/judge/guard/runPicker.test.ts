import { describe, expect, it } from 'vitest'
import type { CodeMapRow } from './codeMap'
import { runPicker, type CallPicker } from './runPicker'

const codeMap: readonly CodeMapRow[] = [
  { path: 'packages/gp-api/src/llm/', agentIds: ['chief_of_staff'], note: 'x' },
]
const registryIds = ['chief_of_staff', 'campaign_assistant']

const agentDirectories = [
  {
    path: 'packages/gp-api/src/chats/general/campaign-manager/',
    agentId: 'campaign_assistant',
  },
]

const baseInput = {
  changedPaths: ['packages/gp-api/src/llm/service.ts'],
  diff: 'diff --git a/x b/x\n+changed',
  floor: [] as string[],
  codeMap,
  agentDirectories,
  registryIds,
}

describe('runPicker — happy path', () => {
  it('adds a validated agent on top of the floor', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [{ agentId: 'chief_of_staff', reason: 'shares the LLM client' }],
      }),
    })
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker },
    )
    expect(result.pickerStatus).toBe('ok')
    expect(result.finalAgents).toEqual(['campaign_assistant', 'chief_of_staff'])
    expect(result.checkConclusion).toBe('neutral')
  })

  it('passes quietly with no agent reached when the picker adds nothing', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({ add: [] }),
    })
    const result = await runPicker(baseInput, { callPicker })
    expect(result.finalAgents).toEqual([])
    expect(result.checkConclusion).toBe('success')
    expect(result.checkTitle).toBe('No agent reached')
  })

  it('drops an unregistered id and names it, keeping the rest', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [
          { agentId: 'chief_of_staff', reason: 'ok' },
          { agentId: 'ghost_agent', reason: 'made up' },
        ],
      }),
    })
    const result = await runPicker(baseInput, { callPicker })
    expect(result.finalAgents).toEqual(['chief_of_staff'])
    expect(result.droppedIds).toEqual(['ghost_agent'])
    expect(result.checkSummary).toContain('ghost_agent')
  })

  it('notes a truncated diff without changing pass/fail', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({ add: [] }),
    })
    const hugeDiff = 'x'.repeat(200 * 1024)
    const result = await runPicker(
      { ...baseInput, diff: hugeDiff },
      { callPicker },
    )
    expect(result.diffTruncated).toBe(true)
    expect(result.checkSummary).toContain('Diff truncated')
  })
})

describe('runPicker — failure handling', () => {
  it('retries once on a thrown error, then falls back to the floor', async () => {
    let calls = 0
    const callPicker: CallPicker = async () => {
      calls++
      throw new Error('timeout')
    }
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker },
    )
    expect(calls).toBe(2)
    expect(result.pickerStatus).toBe('failed')
    expect(result.failureReason).toBe('timeout_or_error')
    expect(result.rawOutput).toBeUndefined()
    expect(result.finalAgents).toEqual(['campaign_assistant'])
    expect(result.checkSummary).toContain(
      'Picker unavailable, ran path-matched agents only',
    )
    expect(result.checkConclusion).toBe('neutral')
  })

  it('retries once on an invalid shape, then falls back and keeps the raw text', async () => {
    const callPicker: CallPicker = async () => ({ raw: 'not json' })
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker },
    )
    expect(result.pickerStatus).toBe('failed')
    expect(result.failureReason).toBe('invalid_shape')
    expect(result.rawOutput).toBe('not json')
    expect(result.checkSummary).toContain('Picker unavailable')
  })

  it('passes without a sweep when there is no floor and the picker failed', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    const result = await runPicker(baseInput, { callPicker })
    expect(result.finalAgents).toEqual([])
    expect(result.failureReason).toBe('timeout_or_error')
    expect(result.checkConclusion).toBe('success')
    expect(result.checkSummary).toContain("Couldn't check shared code")
    expect(result.checkSummary).toContain('/judge')
  })

  it('never blocks the PR: a failure always resolves, never throws', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    await expect(runPicker(baseInput, { callPicker })).resolves.toBeDefined()
  })
})

describe('runPicker — the prompt', () => {
  it('names agent directories and scopes them to their own agent', async () => {
    let user = ''
    const callPicker: CallPicker = async (prompt) => {
      user = prompt.user
      return { raw: JSON.stringify({ add: [] }) }
    }
    await runPicker(baseInput, { callPicker })
    expect(user).toContain(
      '- packages/gp-api/src/chats/general/campaign-manager/ -> ' +
        'campaign_assistant',
    )
    expect(user).toContain(
      'A changed file under an agent directory reaches only that agent, ' +
        'unless a code map row below covers that file.',
    )
  })
})

describe('runPicker — agents the judge cannot sweep', () => {
  const withBlocked = {
    ...baseInput,
    registryIds: [...registryIds, 'compliance_setup'],
  }

  it('leaves out a picked agent the judge cannot sweep and names it', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [
          { agentId: 'chief_of_staff', reason: 'ok' },
          { agentId: 'compliance_setup', reason: 'shared broker' },
        ],
      }),
    })
    const result = await runPicker(
      { ...withBlocked, floor: ['campaign_assistant'] },
      { callPicker },
    )
    expect(result.finalAgents).toEqual(['campaign_assistant', 'chief_of_staff'])
    expect(result.unsweepable).toEqual([
      { agentId: 'compliance_setup', reason: 'blocked' },
    ])
    expect(result.checkSummary).toContain(
      'Not swept, because the judge cannot sweep them: `compliance_setup` ' +
        '(blocked from judging).',
    )
  })

  it('reads as no agent reached when nothing sweepable is left', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [{ agentId: 'compliance_setup', reason: 'shared broker' }],
      }),
    })
    const result = await runPicker(withBlocked, { callPicker })
    expect(result.finalAgents).toEqual([])
    expect(result.checkConclusion).toBe('success')
    expect(result.checkTitle).toBe('No agent reached')
    expect(result.checkSummary).toContain('compliance_setup')
  })

  it('filters the floor fallback too when the picker fails', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    const result = await runPicker(
      { ...withBlocked, floor: ['compliance_setup'] },
      { callPicker },
    )
    expect(result.finalAgents).toEqual([])
    expect(result.checkTitle).toBe('No sweep')
    expect(result.checkSummary).toContain('compliance_setup')
  })

  it('uses an injected reason in place of the registry check', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({ add: [] }),
    })
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker, unsweepableReason: () => 'no_case_list' },
    )
    expect(result.finalAgents).toEqual([])
    expect(result.unsweepable).toEqual([
      { agentId: 'campaign_assistant', reason: 'no_case_list' },
    ])
  })
})
