import { describe, expect, it } from 'vitest'
import { emptyPriorityStatus } from '@goodparty_org/contracts'
import {
  applyStatusUpdate,
  describeStepChange,
  parseStatusToolResult,
  parseStatusUpdate,
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

  it('reports a settled step going back as backwards', () => {
    const base = emptyPriorityStatus()
    const settled = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === 'options' ? { ...s, state: 'settled' as const } : s,
      ),
    }
    const { changes } = applyStatusUpdate(settled, {
      steps: [{ id: 'options', state: 'active' }],
    })
    expect(changes).toEqual([
      { id: 'options', from: 'settled', to: 'active', backwards: true },
    ])
  })

  it('reports forward movement as not backwards', () => {
    const { changes } = applyStatusUpdate(emptyPriorityStatus(), {
      steps: [{ id: 'define', state: 'settled' }],
    })
    expect(changes[0]?.backwards).toBe(false)
  })

  it('records no change when only the summary moved', () => {
    const base = emptyPriorityStatus()
    const active = {
      ...base,
      steps: base.steps.map((s) =>
        s.id === 'plan' ? { ...s, state: 'active' as const } : s,
      ),
    }
    const { changes } = applyStatusUpdate(active, {
      steps: [{ id: 'plan', state: 'active', summary: 'Three meetings' }],
    })
    expect(changes).toEqual([])
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
    const { status, changes } = applyStatusUpdate(defining, {
      steps: [{ id: 'evidence', state: 'active' }],
    })
    expect(status.steps.filter((s) => s.state === 'active')).toHaveLength(1)
    expect(status.steps.find((s) => s.id === 'define')).toMatchObject({
      state: 'open',
      summary: 'The bridge',
    })
    expect(changes).toEqual([
      { id: 'evidence', from: 'open', to: 'active', backwards: false },
      { id: 'define', from: 'active', to: 'open', backwards: false },
    ])
  })

  it('keeps the last active step when one call opens two', () => {
    const { status, changes } = applyStatusUpdate(emptyPriorityStatus(), {
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
    expect(changes).toEqual([
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

  it('returns null for something that is not a status', () => {
    expect(parseStatusToolResult({ presented: true })).toBeNull()
  })
})
