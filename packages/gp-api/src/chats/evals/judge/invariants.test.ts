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
  // word filter. The prompt allows the agent to match the user's framing when
  // the user raised voting, turnout or an election RESULT — an event or a
  // metric, not a word.
  it.each([
    'How did turnout look in the last election?',
    'Did I win my precinct?',
    'How many people voted in the primary?',
  ])('allows voters in an answer to %s', (question) => {
    const found = invariantViolations([
      withText(BASE, VOTERS, question),
      withText(CANDIDATE, VOTERS, question),
    ])
    expect(found).toEqual([])
  })

  // THE CASE I GOT WRONG, asserted so nobody repeats it. "Registered voters"
  // is a population described by its registration status, not an election or
  // a turnout figure — and the rule pre-empts exactly this, one clause
  // earlier: "this applies even when the underlying data is a voter file:
  // report it as constituent data". So the user naming voters does NOT
  // license the answer to, which makes the case list's own probe a VALID
  // detector of the vocabulary regression rather than an exempt one.
  it('does not exempt the case that asks about registered voters', () => {
    const file = path.resolve(__dirname, 'cases', 'chief_of_staff.json')
    const parsed: { cases: { caseId: string; question: string }[] } =
      JSON.parse(readFileSync(file, 'utf8'))
    const probe = parsed.cases.find((c) => c.caseId === 'constituent-count')
    expect(probe).toBeDefined()
    expect(probe?.question).toMatch(/registered voters/i)
    const found = invariantViolations([
      withText(BASE, CONSTITUENTS, probe?.question ?? ''),
      withText(CANDIDATE, VOTERS, probe?.question ?? ''),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.candidateRuns).toBe(1)
    expect(found[0]?.baseRuns).toBe(0)
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

// A MULTI-TURN CASE RENDERS MORE THAN THE USER SAID. `seededTranscript` is a
// prior conversation the HARNESS wrote, assistant turns included, so checking
// the exemption against the whole rendered input lets a seeded turn mentioning
// an election excuse the agent on a case where the user never raised it. The
// exemption reads `turns` — the user's own turns — and nothing else.
describe('a seeded conversation does not widen the exemption', () => {
  const transcript = (
    record: RunRecord,
    output: string,
    turns: string[],
    seeded?: { role: string; content: string }[],
  ): RunRecord => ({
    ...record,
    output: { kind: 'text', value: output },
    input: {
      kind: 'transcript',
      value: { turns, ...(seeded && { seededTranscript: seeded }) },
    },
  })

  it('still reports a violation when only a seeded turn mentioned an election', () => {
    const found = invariantViolations([
      transcript(
        BASE,
        CONSTITUENTS,
        ['What are my priorities?'],
        [
          { role: 'user', content: 'How did the election go?' },
          { role: 'assistant', content: 'You won by four points.' },
        ],
      ),
      transcript(
        CANDIDATE,
        VOTERS,
        ['What are my priorities?'],
        [
          { role: 'user', content: 'How did the election go?' },
          { role: 'assistant', content: 'You won by four points.' },
        ],
      ),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.candidateRuns).toBe(1)
  })

  // The exemption still works when the user raises it in their OWN turns.
  it('exempts when a user turn raised the election', () => {
    const found = invariantViolations([
      transcript(CANDIDATE, VOTERS, [
        'What are my priorities?',
        'And how was turnout?',
      ]),
    ])
    expect(found).toEqual([])
  })
})

// `baseRuns: 0` HAS TWO CAUSES and the headline claims one of them. A base
// arm that produced no answer at all (infraError) cannot have kept a rule —
// nobody checked. Carried so the report can qualify rather than assert.
describe('a base arm that never answered', () => {
  it('is counted apart from a base that kept the rule', () => {
    const found = invariantViolations([
      { ...BASE, output: null },
      withText(CANDIDATE, VOTERS, NEUTRAL),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.baseRuns).toBe(0)
    expect(found[0]?.baseUnknownRuns).toBe(1)
  })

  it('reports zero unknown runs when both arms answered', () => {
    const found = invariantViolations([
      withText(BASE, CONSTITUENTS, NEUTRAL),
      withText(CANDIDATE, VOTERS, NEUTRAL),
    ])
    expect(found[0]?.baseUnknownRuns).toBe(0)
    expect(found[0]?.candidateUnknownRuns).toBe(0)
  })
})
