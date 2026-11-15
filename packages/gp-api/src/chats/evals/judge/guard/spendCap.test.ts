import { describe, expect, it } from 'vitest'
import { decideSpendCap, SPEND_CAP_CENTS } from './spendCap'

const base = {
  floorAgents: ['chief_of_staff'],
  fullAgents: ['chief_of_staff', 'campaign_assistant'],
}

describe('decideSpendCap', () => {
  it('runs the full set when spent + the full estimate is within the cap', () => {
    const decision = decideSpendCap({
      ...base,
      spentCents: 0,
      floorEstimateCents: 1000,
      fullEstimateCents: 2000,
    })
    expect(decision.scope).toBe('full')
    expect(decision.agentsToRun).toEqual(base.fullAgents)
    expect(decision.skippedAgents).toEqual([])
    expect(decision.judgeCommand).toBeUndefined()
  })

  it('is inclusive at exactly the cap for the full set', () => {
    const decision = decideSpendCap({
      ...base,
      spentCents: 0,
      floorEstimateCents: 1000,
      fullEstimateCents: SPEND_CAP_CENTS,
    })
    expect(decision.scope).toBe('full')
  })

  it('runs the floor only when the full set would pass the cap but the floor would not', () => {
    const decision = decideSpendCap({
      ...base,
      spentCents: 3000,
      floorEstimateCents: 1000,
      fullEstimateCents: 3000,
    })
    expect(decision.scope).toBe('floor')
    expect(decision.agentsToRun).toEqual(base.floorAgents)
    expect(decision.skippedAgents).toEqual(['campaign_assistant'])
    expect(decision.judgeCommand).toBe('/judge campaign_assistant --live')
  })

  it('runs nothing when even the floor alone would pass the cap', () => {
    const decision = decideSpendCap({
      ...base,
      spentCents: 4800,
      floorEstimateCents: 1000,
      fullEstimateCents: 2000,
    })
    expect(decision.scope).toBe('none')
    expect(decision.agentsToRun).toEqual([])
    expect(decision.skippedAgents).toEqual(base.fullAgents)
    expect(decision.judgeCommand).toBe(
      '/judge chief_of_staff,campaign_assistant --live',
    )
    expect(decision.note).toMatch(/reached its \$50\.00 guard cap/)
  })

  it('prices the three example spend levels from the test plan: $0, $30, $48', () => {
    const atZero = decideSpendCap({
      ...base,
      spentCents: 0,
      floorEstimateCents: 1000,
      fullEstimateCents: 2000,
    })
    expect(atZero.scope).toBe('full')

    const atThirty = decideSpendCap({
      ...base,
      spentCents: 3000,
      floorEstimateCents: 1000,
      fullEstimateCents: 2500,
    })
    expect(atThirty.scope).toBe('floor')

    const atFortyEight = decideSpendCap({
      ...base,
      spentCents: 4800,
      floorEstimateCents: 500,
      fullEstimateCents: 1000,
    })
    expect(atFortyEight.scope).toBe('none')
  })
})
