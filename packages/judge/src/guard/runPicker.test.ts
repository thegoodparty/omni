import { describe, expect, it } from 'vitest'
import type { CodeMapRow } from './codeMap'
import { runPicker, type CallPicker } from './runPicker'

const sweepsAll = () => undefined

const codeMap: readonly CodeMapRow[] = [
  { path: 'packages/gp-api/src/llm/', suites: ['chief_of_staff'], note: 'x' },
]
const registryIds = ['chief_of_staff', 'campaign_assistant']

const suiteDirectories = [
  {
    path: 'packages/gp-api/src/chats/general/campaign-manager/',
    suites: ['campaign_assistant'],
  },
]

const baseInput = {
  changedPaths: ['packages/gp-api/src/llm/service.ts'],
  diff: 'diff --git a/x b/x\n+changed',
  floor: [] as string[],
  codeMap,
  suiteDirectories,
  registryIds,
}

describe('runPicker — happy path', () => {
  it('adds a validated agent on top of the floor', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [{ suite: 'chief_of_staff', reason: 'shares the LLM client' }],
      }),
    })
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker, unsweepableReason: sweepsAll },
    )
    expect(result.pickerStatus).toBe('ok')
    expect(result.finalSuites).toEqual(['campaign_assistant', 'chief_of_staff'])
  })

  it('passes quietly with no agent reached when the picker adds nothing', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({ add: [] }),
    })
    const result = await runPicker(baseInput, {
      callPicker,
      unsweepableReason: sweepsAll,
    })
    expect(result.finalSuites).toEqual([])
    expect(result.title).toBe('No suite reached')
  })

  it('drops an unregistered id and names it, keeping the rest', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [
          { suite: 'chief_of_staff', reason: 'ok' },
          { suite: 'ghost_agent', reason: 'made up' },
        ],
      }),
    })
    const result = await runPicker(baseInput, {
      callPicker,
      unsweepableReason: sweepsAll,
    })
    expect(result.finalSuites).toEqual(['chief_of_staff'])
    expect(result.droppedIds).toEqual(['ghost_agent'])
    expect(result.summary).toContain('ghost_agent')
  })

  it('notes a truncated diff without changing pass/fail', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({ add: [] }),
    })
    const hugeDiff = 'x'.repeat(200 * 1024)
    const result = await runPicker(
      { ...baseInput, diff: hugeDiff },
      { callPicker, unsweepableReason: sweepsAll },
    )
    expect(result.diffTruncated).toBe(true)
    expect(result.summary).toContain('Diff truncated')
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
      { callPicker, unsweepableReason: sweepsAll },
    )
    expect(calls).toBe(2)
    expect(result.pickerStatus).toBe('failed')
    expect(result.failureReason).toBe('timeout_or_error')
    expect(result.rawOutput).toBeUndefined()
    expect(result.finalSuites).toEqual(['campaign_assistant'])
    expect(result.summary).toContain(
      'Picker unavailable, ran path-matched agents only',
    )
  })

  it('retries once on an invalid shape, then falls back and keeps the raw text', async () => {
    const callPicker: CallPicker = async () => ({ raw: 'not json' })
    const result = await runPicker(
      { ...baseInput, floor: ['campaign_assistant'] },
      { callPicker, unsweepableReason: sweepsAll },
    )
    expect(result.pickerStatus).toBe('failed')
    expect(result.failureReason).toBe('invalid_shape')
    expect(result.rawOutput).toBe('not json')
    expect(result.summary).toContain('Picker unavailable')
  })

  it('passes without a sweep when there is no floor and the picker failed', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    const result = await runPicker(baseInput, {
      callPicker,
      unsweepableReason: sweepsAll,
    })
    expect(result.finalSuites).toEqual([])
    expect(result.failureReason).toBe('timeout_or_error')
    expect(result.summary).toContain("Couldn't check shared code")
    expect(result.summary).toContain('/judge')
  })

  it('never blocks the PR: a failure always resolves, never throws', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    await expect(
      runPicker(baseInput, { callPicker, unsweepableReason: sweepsAll }),
    ).resolves.toBeDefined()
  })
})

describe('runPicker — the prompt', () => {
  it('names suite directories and scopes them to their own suites', async () => {
    let user = ''
    const callPicker: CallPicker = async (prompt) => {
      user = prompt.user
      return { raw: JSON.stringify({ add: [] }) }
    }
    await runPicker(baseInput, { callPicker, unsweepableReason: sweepsAll })
    expect(user).toContain(
      '- packages/gp-api/src/chats/general/campaign-manager/ -> ' +
        'campaign_assistant',
    )
    expect(user).toContain(
      "A changed file under a suite directory reaches only that directory's " +
        'suites, unless a code map row below covers that file.',
    )
  })
})

describe('runPicker — suites judge-eval cannot run', () => {
  const reason = (suite: string) =>
    suite === 'caseScoutGate' ? ('not_pairwise' as const) : undefined
  const withGate = {
    ...baseInput,
    registryIds: [...registryIds, 'caseScoutGate'],
  }

  it('leaves out a picked suite that is not pairwise and names it', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [
          { suite: 'chief_of_staff', reason: 'ok' },
          { suite: 'caseScoutGate', reason: 'shared llm' },
        ],
      }),
    })
    const result = await runPicker(
      { ...withGate, floor: ['campaign_assistant'] },
      { callPicker, unsweepableReason: reason },
    )
    expect(result.finalSuites).toEqual(['campaign_assistant', 'chief_of_staff'])
    expect(result.unsweepable).toEqual([
      { suite: 'caseScoutGate', reason: 'not_pairwise' },
    ])
    expect(result.summary).toContain(
      'Not run, because judge-eval cannot run them: `caseScoutGate` ' +
        '(not a pairwise suite).',
    )
  })

  it('reads as no suite reached when nothing runnable is left', async () => {
    const callPicker: CallPicker = async () => ({
      raw: JSON.stringify({
        add: [{ suite: 'caseScoutGate', reason: 'shared llm' }],
      }),
    })
    const result = await runPicker(withGate, {
      callPicker,
      unsweepableReason: reason,
    })
    expect(result.finalSuites).toEqual([])
    expect(result.title).toBe('No suite reached')
  })

  it('filters the floor fallback too when the picker fails', async () => {
    const callPicker: CallPicker = async () => {
      throw new Error('down')
    }
    const result = await runPicker(
      { ...withGate, floor: ['caseScoutGate'] },
      { callPicker, unsweepableReason: reason },
    )
    expect(result.finalSuites).toEqual([])
    expect(result.title).toBe('No sweep')
    expect(result.summary).toContain('caseScoutGate')
  })
})
