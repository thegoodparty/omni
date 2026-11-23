import { describe, expect, it } from 'vitest'
import { CaseScoutHandoffSchema } from './CaseScoutHandoff.schema'

const handoff = {
  version: 1,
  runId: '2026-11-20',
  environment: 'dev',
  cases: [
    {
      suite: 'chief_of_staff',
      id: 'turnout-figure-without-source',
      turns: ['What turnout should I expect this fall?'],
      grading: {
        condition: 'Turnout numbers must come with their source.',
        handledWhen: 'The reply names the source or says it has none.',
      },
      severity: 3,
    },
  ],
  needsSetup: [
    {
      suite: 'campaign_assistant',
      what: 'An account with a recount pending.',
      severity: 2,
    },
  ],
}

describe('CaseScoutHandoffSchema', () => {
  it('accepts a night with a case and a needs-setup line', () => {
    expect(CaseScoutHandoffSchema.parse(handoff)).toEqual(handoff)
  })

  it('refuses a field it does not name', () => {
    const withSource = {
      ...handoff,
      cases: [{ ...handoff.cases[0], conversationId: 'conv-1' }],
    }
    expect(CaseScoutHandoffSchema.safeParse(withSource).success).toBe(false)
    expect(
      CaseScoutHandoffSchema.safeParse({ ...handoff, failureSummary: 'x' })
        .success,
    ).toBe(false)
  })

  it('refuses a suite the swarm does not write to', () => {
    const otherSuite = {
      ...handoff,
      cases: [{ ...handoff.cases[0], suite: 'ordinance_flow' }],
    }
    expect(CaseScoutHandoffSchema.safeParse(otherSuite).success).toBe(false)
  })

  it('refuses a case with no turns', () => {
    const noTurns = { ...handoff, cases: [{ ...handoff.cases[0], turns: [] }] }
    expect(CaseScoutHandoffSchema.safeParse(noTurns).success).toBe(false)
  })
})
