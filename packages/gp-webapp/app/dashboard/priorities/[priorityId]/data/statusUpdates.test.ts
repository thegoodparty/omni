import { describe, expect, it } from 'vitest'
import {
  emptyPriorityStatus,
  type PriorityStatus,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'
import {
  applyStatusUpdate,
  describeStepChange,
  parseStatusToolResult,
  parseStatusUpdate,
  statusChanges,
} from './statusUpdates'

describe('parseStatusUpdate', () => {
  it('accepts a call that omits nextAction', () => {
    expect(
      parseStatusUpdate({ steps: [{ id: 'define', state: 'active' }] }),
    ).toEqual({ steps: [{ id: 'define', state: 'active' }] })
  })

  it('rejects an unknown step id', () => {
    expect(
      parseStatusUpdate({ steps: [{ id: 'nope', state: 'active' }] }),
    ).toBeNull()
  })
})

describe('applyStatusUpdate', () => {
  it('leaves untouched steps exactly as they were', () => {
    const current = emptyPriorityStatus()
    const { status } = applyStatusUpdate(current, {
      steps: [{ id: 'define', state: 'active' }],
    })
    expect(status.steps).toHaveLength(7)
    expect(status.steps.find((s) => s.id === 'evidence')).toEqual({
      id: 'evidence',
      state: 'open',
      summary: '',
    })
  })

  it('keeps a stored check on a patch that does not carry one', () => {
    const current = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((s) =>
        s.id === 'define'
          ? {
              ...s,
              state: 'settled' as const,
              check: {
                state: 'out' as const,
                who: 'Renters on Maple',
                question: 'Is this it?',
                raised: 0,
              },
            }
          : s,
      ),
    }
    const { status } = applyStatusUpdate(current, {
      steps: [{ id: 'define', state: 'settled', summary: 'Potholes' }],
    })
    expect(status.steps.find((s) => s.id === 'define')?.check?.state).toBe(
      'out',
    )
  })

  it('counts a deferral recorded over a deferral, as the server does', () => {
    const deferred = parseStatusUpdate({
      steps: [
        {
          id: 'define',
          state: 'settled',
          check: { state: 'deferred', when: 'after the hearing' },
        },
      ],
    })
    if (deferred === null) throw new Error('expected a parsed update')
    const once = applyStatusUpdate(emptyPriorityStatus(), deferred).status
    const twice = applyStatusUpdate(once, deferred).status
    expect(twice.steps.find((s) => s.id === 'define')?.check).toMatchObject({
      state: 'deferred',
      when: 'after the hearing',
      raised: 1,
    })
  })

  it('never shows a check on a step that is not a gate', () => {
    const { status } = applyStatusUpdate(emptyPriorityStatus(), {
      steps: [
        {
          id: 'listen_problem',
          state: 'settled',
          check: { state: 'confirmed' },
        },
      ],
    })
    const listen = status.steps.find((s) => s.id === 'listen_problem')
    expect(listen?.state).toBe('settled')
    expect(listen?.check).toBeUndefined()
  })

  it('still moves the step when the check is malformed', () => {
    expect(
      parseStatusUpdate({
        steps: [{ id: 'define', state: 'settled', check: { state: 'maybe' } }],
      }),
    ).toEqual({ steps: [{ id: 'define', state: 'settled' }] })
  })

  it('keeps a stored summary when the patch omits one', () => {
    const current = {
      ...emptyPriorityStatus(),
      steps: emptyPriorityStatus().steps.map((s) =>
        s.id === 'define'
          ? { ...s, state: 'settled' as const, summary: 'Potholes on Maple' }
          : s,
      ),
    }
    const { status } = applyStatusUpdate(current, {
      steps: [{ id: 'define', state: 'stale' }],
    })
    expect(status.steps.find((s) => s.id === 'define')?.summary).toBe(
      'Potholes on Maple',
    )
  })

  it('clears a caveat on an empty string and keeps it when omitted', () => {
    const base = emptyPriorityStatus()
    const withCaveat = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === 'evidence' ? { ...s, caveat: 'Thin sample' } : s,
      ),
    }
    const kept = applyStatusUpdate(withCaveat, {
      steps: [{ id: 'evidence', state: 'active' }],
    })
    expect(kept.status.steps.find((s) => s.id === 'evidence')?.caveat).toBe(
      'Thin sample',
    )
    const cleared = applyStatusUpdate(withCaveat, {
      steps: [{ id: 'evidence', state: 'settled', caveat: '' }],
    })
    expect(
      cleared.status.steps.find((s) => s.id === 'evidence')?.caveat,
    ).toBeUndefined()
  })

  // The server's applyUpdate enforces one active step. The client mirror has
  // to agree, or the live rail and the replayed markers drift from it.
  it('demotes the previously active step when another opens', () => {
    const base = emptyPriorityStatus()
    const defining = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === 'define'
          ? { ...s, state: 'active' as const, summary: 'The bridge' }
          : s,
      ),
    }
    const { status } = applyStatusUpdate(defining, {
      steps: [{ id: 'evidence', state: 'active' }],
    })
    expect(status.steps.filter((s) => s.state === 'active')).toHaveLength(1)
    expect(status.steps.find((s) => s.id === 'define')).toMatchObject({
      state: 'open',
      summary: 'The bridge',
    })
    expect(statusChanges(defining, status)).toEqual([
      { id: 'define', from: 'active', to: 'open', backwards: false },
      { id: 'evidence', from: 'open', to: 'active', backwards: false },
    ])
  })

  it('keeps the last active step when one call opens two', () => {
    const before = emptyPriorityStatus()
    const { status } = applyStatusUpdate(before, {
      steps: [
        { id: 'define', state: 'active' },
        { id: 'evidence', state: 'active' },
      ],
    })
    expect(
      status.steps.filter((s) => s.state === 'active').map((s) => s.id),
    ).toEqual(['evidence'])
    // define went open -> active -> open inside one call: no net move, so no
    // marker for it.
    expect(statusChanges(before, status)).toEqual([
      { id: 'evidence', from: 'open', to: 'active', backwards: false },
    ])
  })

  it('does not demote when a call only settles a step', () => {
    const base = emptyPriorityStatus()
    const defining = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === 'define' ? { ...s, state: 'active' as const } : s,
      ),
    }
    const { status } = applyStatusUpdate(defining, {
      steps: [{ id: 'evidence', state: 'settled' }],
    })
    expect(status.steps.find((s) => s.id === 'define')?.state).toBe('active')
  })
})

const withStates = (
  states: Partial<Record<PriorityStepId, PriorityStepState>>,
): PriorityStatus => ({
  ...emptyPriorityStatus(),
  steps: emptyPriorityStatus().steps.map((s) => ({
    ...s,
    state: states[s.id] ?? s.state,
  })),
})

describe('statusChanges', () => {
  it('reports a settled step going back as backwards', () => {
    expect(
      statusChanges(
        withStates({ options: 'settled' }),
        withStates({ options: 'active' }),
      ),
    ).toEqual([
      { id: 'options', from: 'settled', to: 'active', backwards: true },
    ])
  })

  it('reports forward movement as not backwards', () => {
    expect(
      statusChanges(emptyPriorityStatus(), withStates({ define: 'settled' })),
    ).toEqual([{ id: 'define', from: 'open', to: 'settled', backwards: false }])
  })

  it('records no change when only the summary moved', () => {
    const before = withStates({ plan: 'active' })
    const { status } = applyStatusUpdate(before, {
      steps: [{ id: 'plan', state: 'active', summary: 'Three meetings' }],
    })
    expect(statusChanges(before, status)).toEqual([])
  })

  it('names only the moves the stored status shows when the call asked for more', () => {
    const before = withStates({ define: 'settled', evidence: 'active' })
    // Asked: evidence settled, options settled, method active. Stored:
    // evidence settled and options active, nothing else.
    const stored = withStates({
      define: 'settled',
      evidence: 'settled',
      options: 'active',
    })
    const result = parseStatusToolResult({
      status: stored,
      currentStep: 'options',
      nextAction: 'Draft two options',
    })
    expect(
      statusChanges(before, result?.status ?? before).map(describeStepChange),
    ).toEqual(['Done with what we know', 'Working on your options'])
  })
})

describe('describeStepChange', () => {
  it('names a settled step', () => {
    expect(
      describeStepChange({
        id: 'evidence',
        from: 'active',
        to: 'settled',
        backwards: false,
      }),
    ).toBe('Done with what we know')
  })

  it('says a step went back when it did', () => {
    expect(
      describeStepChange({
        id: 'options',
        from: 'settled',
        to: 'active',
        backwards: true,
      }),
    ).toBe('Back to your options')
  })

  it('says a stale step needs another look', () => {
    expect(
      describeStepChange({
        id: 'evidence',
        from: 'settled',
        to: 'stale',
        backwards: true,
      }),
    ).toBe('What we know needs another look')
  })
})

describe('parseStatusToolResult', () => {
  it('reads the merged status the tool returns', () => {
    const result = parseStatusToolResult({
      status: emptyPriorityStatus(),
      currentStep: 'define',
      nextAction: 'Pick two blocks to walk',
    })
    expect(result?.nextAction).toBe('Pick two blocks to walk')
    expect(result?.status.steps).toHaveLength(7)
  })

  // The plan turn on dev: the agent asked to close three steps and reopen a
  // fourth, and the server refused all of it. A refusal is nothing stored,
  // so nothing moves and no marker is drawn.
  it('reads a refusal as nothing stored', () => {
    expect(
      parseStatusToolResult({
        error: 'Nothing was recorded. These did not move: The path, The plan.',
      }),
    ).toBeNull()
  })

  it('returns null for something that is not a status', () => {
    expect(parseStatusToolResult({ presented: true })).toBeNull()
  })
})
