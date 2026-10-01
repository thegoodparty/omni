import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_PAIR } from './fixtures/records'
import { AGENT_INVARIANTS, invariantViolations } from './invariants'
import type { RunRecord } from './record'

const [BASE, CANDIDATE] = CHAT_PAIR

const withText = (
  record: RunRecord,
  output: string,
  question?: string,
): RunRecord => ({
  ...record,
  output: { kind: 'text', value: output },
  ...(question !== undefined && {
    input: { kind: 'question', value: question },
  }),
})

const NEUTRAL = 'What are my top priorities right now?'
const CONSTITUENTS = 'You have three priorities, raised by constituents.'
const VOTERS = 'You have three priorities, raised by voters in your district.'

describe('the chief of staff vocabulary invariant', () => {
  it('reports a candidate that says voters where the base did not', () => {
    const found = invariantViolations([
      withText(BASE, CONSTITUENTS, NEUTRAL),
      withText(CANDIDATE, VOTERS, NEUTRAL),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.invariant).toBe('constituents-not-voters')
    expect(found[0]?.candidateRuns).toBe(1)
    expect(found[0]?.baseRuns).toBe(0)
    expect(found[0]?.candidateCaseIds).toEqual([CANDIDATE.caseId])
  })

  // THE EXEMPTION, and it is the half that makes this a rule rather than a
  // word filter. The prompt allows the agent to match the user's framing for
  // that answer when the user raised voting themselves.
  it('allows voters in an answer where the user raised voting', () => {
    const found = invariantViolations([
      withText(BASE, VOTERS, 'How many registered voters are under 30?'),
      withText(CANDIDATE, VOTERS, 'How many registered voters are under 30?'),
    ])
    expect(found).toEqual([])
  })

  // The real case list's own probe, checked against the real rule. This case
  // CANNOT detect the vocabulary regression, because the user says "voters"
  // in the question and the rule therefore permits the answer to. Asserted so
  // nobody reads a silent invariant on this case as the agent behaving.
  it('is exempt on the case list case that asks about registered voters', () => {
    const file = path.resolve(__dirname, 'cases', 'chief_of_staff.json')
    const parsed: { cases: { caseId: string; question: string }[] } =
      JSON.parse(readFileSync(file, 'utf8'))
    const probe = parsed.cases.find((c) => c.caseId === 'constituent-count')
    expect(probe).toBeDefined()
    expect(probe?.question).toMatch(/voters/i)
    const found = invariantViolations([
      withText(BASE, VOTERS, probe?.question ?? ''),
      withText(CANDIDATE, VOTERS, probe?.question ?? ''),
    ])
    expect(found).toEqual([])
  })

  // The prompt says the rule "applies even when the underlying data is a
  // voter file: report it as constituent data", so naming the file is a
  // violation. That is the rule as written.
  it('counts naming the voter file as a violation', () => {
    const found = invariantViolations([
      withText(
        CANDIDATE,
        'I can see your voter file for the district.',
        NEUTRAL,
      ),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.candidateRuns).toBe(1)
  })

  it('separates a rule both arms break from one the candidate introduced', () => {
    const found = invariantViolations([
      withText(BASE, VOTERS, NEUTRAL),
      withText(CANDIDATE, VOTERS, NEUTRAL),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.baseRuns).toBe(1)
    expect(found[0]?.candidateRuns).toBe(1)
  })

  it('reports a rule only the base broke, which is the branch fixing it', () => {
    const found = invariantViolations([
      withText(BASE, VOTERS, NEUTRAL),
      withText(CANDIDATE, CONSTITUENTS, NEUTRAL),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.baseRuns).toBe(1)
    expect(found[0]?.candidateRuns).toBe(0)
    expect(found[0]?.candidateCaseIds).toEqual([])
  })

  // An infraError has no answer. Counting it either way would be inventing a
  // fact about an output that does not exist.
  //
  // Checked with a rule that fires on ANYTHING, because the real vocabulary
  // rule does not match a null output either way — so with the real rule this
  // test passes whether the guard is there or not, and proves nothing.
  it('skips a run with no output at all', () => {
    const alwaysFires = {
      chief_of_staff: [
        {
          name: 'always-fires',
          describe:
            'a rule written to fire, so the guard is the only thing ' +
            'that can keep it quiet',
          violated: () => true,
        },
      ],
    }
    expect(
      invariantViolations([{ ...CANDIDATE, output: null }], alwaysFires),
    ).toEqual([])
    // And it is the null that is doing it, not the rule being unreachable.
    expect(
      invariantViolations(
        [withText(CANDIDATE, 'anything', NEUTRAL)],
        alwaysFires,
      ),
    ).toHaveLength(1)
  })

  it('says nothing about an agent with no invariants', () => {
    const found = invariantViolations([
      withText({ ...CANDIDATE, agentId: 'ordinance_flow' }, VOTERS, NEUTRAL),
    ])
    expect(found).toEqual([])
  })

  it('carries the rule text, so the report does not restate it', () => {
    const found = invariantViolations([withText(CANDIDATE, VOTERS, NEUTRAL)])
    expect(found[0]?.describe).toMatch(/constituents/i)
    expect(found[0]?.describe.length).toBeGreaterThan(40)
  })
})

describe('the invariant registry', () => {
  it('is keyed by agent id and reaches the chief of staff', () => {
    expect(AGENT_INVARIANTS.chief_of_staff).toBeDefined()
    expect(AGENT_INVARIANTS.chief_of_staff?.length).toBeGreaterThan(0)
  })

  it('takes an injected registry, so a rule can be tested in isolation', () => {
    const found = invariantViolations(
      [withText(CANDIDATE, 'anything at all', NEUTRAL)],
      {
        chief_of_staff: [
          {
            name: 'always-fires',
            describe: 'a rule written to fire, for the harness itself',
            violated: () => true,
          },
        ],
      },
    )
    expect(found.map((v) => v.invariant)).toEqual(['always-fires'])
  })
})
