import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { COVERED_SCOPES } from '@/caseScout/caseScout.config'
import { KNOWN_PATTERNS } from '@/caseScout/caseScout.prompts'
import { segmentIntoSessions } from '@/caseScout/util/sessions.util'
import { renderSessionTranscript } from '@/caseScout/util/transcript.util'
import { CASES_DIR } from '../judge/cases'
import { estimateBefore } from './cost'
import {
  BenchFixtureSchema,
  conversationIdOf,
  fixtureMessages,
  FIXTURES_DIR,
  loadFixtures,
} from './fixtures'
import {
  draftLoaderIssue,
  readLocalCaseList,
  runBench,
  type BenchModel,
} from './runner'
import { fixtureIdOf, labelEchoModel } from './stubs'

// Every model call here is a stand-in; nothing reaches Anthropic.
const NOW = parseISO('2026-11-10T06:00:00Z')
const FIXTURES = loadFixtures()
const STUB = labelEchoModel(FIXTURES)

const run = (overrides: Partial<BenchModel> = {}) =>
  runBench({
    fixtures: FIXTURES,
    model: { ...STUB, ...overrides },
    now: NOW,
    runId: 'bench-test',
  })

const resultFor = async (overrides: Partial<BenchModel>, fixtureId: string) => {
  const bench = await run(overrides)
  const result = bench.results.find((r) => r.id === fixtureId)
  if (!result) throw new Error(`no result for ${fixtureId}`)
  return result
}

describe('the bench fixtures', () => {
  it('match the proposal', () => {
    const count = (category: string) =>
      FIXTURES.filter((f) => f.category === category).length
    expect(count('known_pattern')).toBe(9)
    expect(count('good')).toBe(5)
    expect(count('borderline')).toBe(2)
    expect(count('planted_pii')).toBe(2)
    expect(count('duplicate')).toBe(1)
    expect(count('uncovered_agent')).toBe(1)
    expect(count('hidden_context')).toBe(6)
  })

  it('carry one known-pattern fixture per pattern', () => {
    const patterns = FIXTURES.filter((f) => f.category === 'known_pattern')
      .map((f) => f.expect.pattern)
      .sort()
    expect(patterns).toEqual(
      KNOWN_PATTERNS.filter((pattern) => pattern !== 'none').sort(),
    )
  })

  it('are one session each', () => {
    const sessions = segmentIntoSessions(fixtureMessages(FIXTURES))
    expect(sessions.map((s) => s.conversationId).sort()).toEqual(
      FIXTURES.map(conversationIdOf).sort(),
    )
  })

  it('put tool calls in the scoring transcript', () => {
    const session = segmentIntoSessions(fixtureMessages(FIXTURES)).find((s) =>
      s.conversationId.endsWith('f08-inflated-background-saved'),
    )
    if (!session) throw new Error('f08 did not reach a session')
    expect(renderSessionTranscript(session)).toContain(
      'tool: campaign_story input: {"action":"save"',
    )
  })

  it('give only the uncovered fixture a scope the scout skips', () => {
    for (const fixture of FIXTURES) {
      expect(COVERED_SCOPES.has(fixture.agent)).toBe(
        fixture.category !== 'uncovered_agent',
      )
    }
  })

  it('name only cases that exist on the agent lists', () => {
    for (const fixture of FIXTURES) {
      const { cases } = JSON.parse(
        readFileSync(path.join(CASES_DIR, `${fixture.agent}.json`), 'utf8'),
      ) as { cases: Array<{ caseId: string }> }
      const ids = new Set(cases.map((c) => c.caseId))
      const named = [
        fixture.expect.covered_by,
        ...fixture.expect.also_pass_if_covered_by,
      ].filter((id) => id !== null)
      for (const id of named) expect(ids.has(id)).toBe(true)
    }
  })

  it('actually plant the PII they list', () => {
    for (const fixture of FIXTURES) {
      const text = fixture.messages.map((m) => m.content).join('\n')
      for (const planted of fixture.planted_pii) {
        expect(text).toContain(planted)
      }
    }
  })

  it('carry no em or en dashes', () => {
    for (const name of readdirSync(FIXTURES_DIR)) {
      const text = readFileSync(path.join(FIXTURES_DIR, name), 'utf8')
      expect(text).not.toMatch(/[–—]/)
    }
  })

  it('refuse a label that contradicts itself', () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(FIXTURES_DIR, 'g01-candidate-forum-prep.json'),
        'utf8',
      ),
    ) as { expect: { drop_ok: boolean } }
    raw.expect.drop_ok = true
    const parsed = BenchFixtureSchema.safeParse(raw)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('drop_ok')
  })

  it('refuse a draft expected below the drafting severity', () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(FIXTURES_DIR, 'h05-texting-deadline-contradicts-map.json'),
        'utf8',
      ),
    ) as { expect: { max_severity: number } }
    raw.expect.max_severity = 1
    const parsed = BenchFixtureSchema.safeParse(raw)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('max_severity')
  })
})

describe('runBench with label-echo stubs', () => {
  it('passes every fixture when the scout does what the labels say', async () => {
    const bench = await run()
    expect(
      bench.results.filter((r) => !r.passed).map((r) => [r.id, r.checks]),
    ).toEqual([])
    expect(bench.results.filter((r) => r.case).length).toBe(12)
  })

  it('never scores the uncovered scope', async () => {
    const bench = await run()
    const uncovered = bench.results.find((r) => r.id.startsWith('u01-'))
    expect(bench.calls.some((c) => c.sessionId.includes('u01-'))).toBe(false)
    expect(uncovered?.checks.ignored?.status).toBe('pass')
  })
})

describe('the checks catch a regression', () => {
  it('fails every should-draft fixture when everything scores clean', async () => {
    const bench = await run({
      scoreTranscript: async (scope, transcript, signal) => {
        const response = await STUB.scoreTranscript(scope, transcript, signal)
        return {
          ...response,
          requests: response.requests.map((r) => ({
            ...r,
            severity: 0 as const,
            known_pattern: 'none' as const,
          })),
        }
      },
    })
    for (const result of bench.results) {
      if (result.expect.should_draft && !result.expect.drop_ok) {
        expect(result.checks.drafted?.status).toBe('fail')
      }
      if (result.expect.pattern !== null) {
        expect(result.checks.pattern?.status).toBe('fail')
      }
    }
  })

  it('fails only the pattern check for a wrong pattern', async () => {
    const result = await resultFor(
      {
        scoreTranscript: async (scope, transcript, signal) => {
          const response = await STUB.scoreTranscript(scope, transcript, signal)
          return fixtureIdOf(transcript) === 'f01-unsourced-turnout-math'
            ? {
                ...response,
                requests: response.requests.map((r) => ({
                  ...r,
                  known_pattern: 'date_arithmetic' as const,
                })),
              }
            : response
        },
      },
      'f01-unsourced-turnout-math',
    )
    expect(result.checks.pattern?.status).toBe('fail')
    expect(result.checks.drafted?.status).toBe('pass')
  })

  const withDraftQuestion = (fixtureId: string, question: string) => ({
    draftCase: async (
      system: string,
      transcript: string,
      signal: AbortSignal,
    ) => {
      const text = await STUB.draftCase(system, transcript, signal)
      if (fixtureIdOf(transcript) !== fixtureId) return text
      const draft = JSON.parse(text) as { case: { question: string } }
      draft.case.question = question
      return JSON.stringify(draft)
    },
  })

  it('fails no_planted_pii for a planted name the gate misses', async () => {
    const result = await resultFor(
      withDraftQuestion(
        'p01-pii-neighbor-daycare-accusation',
        'Is Della Fairbrook running an unlicensed daycare?',
      ),
      'p01-pii-neighbor-daycare-accusation',
    )
    expect(result.checks.no_planted_pii?.status).toBe('fail')
    expect(result.checks.no_planted_pii?.detail).toContain('Della Fairbrook')
  })

  it('passes a drop-ok fixture whose planted phone the gate catches', async () => {
    const result = await resultFor(
      withDraftQuestion(
        'p01-pii-neighbor-daycare-accusation',
        'Should I call the resident back at (307) 555-0148?',
      ),
      'p01-pii-neighbor-daycare-accusation',
    )
    expect(result.outcome).toBe('gated')
    expect(result.gate?.rule).toBe('contactPattern')
    expect(result.checks.drafted?.status).toBe('pass')
    expect(result.checks.no_planted_pii?.detail).toContain('gate dropped it')
  })

  it('fails a must-draft fixture whose draft the second read blocks', async () => {
    const result = await resultFor(
      { secondRead: async () => '["Somewhere Real"]' },
      'f02-modeled-party-as-registration',
    )
    expect(result.gate).toMatchObject({
      passed: false,
      rule: 'secondRead',
      flagged: ['Somewhere Real'],
    })
    expect(result.checks.drafted?.status).toBe('fail')
  })

  it('holds a draft that names a year after its chat, as the job does', async () => {
    const result = await resultFor(
      withDraftQuestion(
        'f02-modeled-party-as-registration',
        'How many registered voters did each party have in 2029?',
      ),
      'f02-modeled-party-as-registration',
    )
    expect(result.outcome).toBe('heldForDate')
    expect(result.gate?.passed).toBe(true)
    expect(result.case).toBeNull()
    expect(result.checks.drafted?.status).toBe('fail')
  })

  it('hands the second read the session it was drafted from', async () => {
    const sources: string[] = []
    const result = await resultFor(
      {
        secondRead: async (_draftText, sourceText) => {
          sources.push(sourceText)
          return '[]'
        },
      },
      'f02-modeled-party-as-registration',
    )
    expect(result.gate).toMatchObject({ passed: true, flagged: null })
    const fixture = FIXTURES.find(
      (f) => f.id === 'f02-modeled-party-as-registration',
    )
    const firstUserTurn = fixture?.messages.find((m) => m.role === 'user')
    expect(firstUserTurn).toBeDefined()
    expect(
      sources.some((source) =>
        source.includes(firstUserTurn?.content ?? '(none)'),
      ),
    ).toBe(true)
  })

  it('fails the duplicate when the scout drafts it', async () => {
    const result = await resultFor(
      {
        draftCase: async (system, transcript, signal) =>
          fixtureIdOf(transcript) === 'd01-claims-meeting-booked'
            ? JSON.stringify({
                outcome: 'newCase',
                failureSummary: 'claims a booking',
                case: {
                  caseId: 'claims-booking',
                  question: 'q',
                  condition: 'c',
                  handledWhen: 'h',
                },
              })
            : STUB.draftCase(system, transcript, signal),
      },
      'd01-claims-meeting-booked',
    )
    expect(result.checks.drafted?.status).toBe('fail')
    expect(result.checks.skipped_as_covered?.status).toBe('fail')
  })

  it('passes an accepted covered-by alternative', async () => {
    const result = await resultFor(
      {
        draftCase: async (system, transcript, signal) =>
          fixtureIdOf(transcript) === 'f09-outside-canvassing-app'
            ? JSON.stringify({
                outcome: 'coveredBy',
                failureSummary: 'outside tool',
                caseId: 'product-how-to-from-the-map',
              })
            : STUB.draftCase(system, transcript, signal),
      },
      'f09-outside-canvassing-app',
    )
    expect(result.outcome).toBe('covered')
    expect(result.checks.drafted?.status).toBe('pass')
  })

  it('fails a borderline chat the scout drafts', async () => {
    const result = await resultFor(
      {
        scoreTranscript: async (scope, transcript, signal) => {
          const response = await STUB.scoreTranscript(scope, transcript, signal)
          return fixtureIdOf(transcript) ===
            'b01-six-slogans-when-asked-for-three'
            ? {
                ...response,
                requests: response.requests.map((r) => ({
                  ...r,
                  severity: 2 as const,
                })),
              }
            : response
        },
      },
      'b01-six-slogans-when-asked-for-three',
    )
    expect(result.checks.drafted?.status).toBe('fail')
  })

  const withSeverity = (fixtureId: string, severity: 0 | 1 | 2 | 3) => ({
    scoreTranscript: async (
      scope: string,
      transcript: string,
      signal: AbortSignal,
    ) => {
      const response = await STUB.scoreTranscript(scope, transcript, signal)
      return fixtureIdOf(transcript) === fixtureId
        ? {
            ...response,
            requests: response.requests.map((r) => ({ ...r, severity })),
          }
        : response
    },
  })

  it('fails the severity check on a flag the drafter sends to setup', async () => {
    const result = await resultFor(
      {
        ...withSeverity('h01-win-number-and-cells-from-briefing', 3),
        draftCase: async (system, transcript, signal) =>
          fixtureIdOf(transcript) === 'h01-win-number-and-cells-from-briefing'
            ? JSON.stringify({
                outcome: 'needsSetup',
                failureSummary: 'win number with no source',
                what: 'A race record with a win number.',
              })
            : STUB.draftCase(system, transcript, signal),
      },
      'h01-win-number-and-cells-from-briefing',
    )
    expect(result.outcome).toBe('needsSetup')
    expect(result.checks.drafted?.status).toBe('pass')
    expect(result.checks.severity).toEqual({
      status: 'fail',
      detail: 'expected at most 1, scout gave 3',
    })
    expect(result.passed).toBe(false)
  })

  it('passes a severity at the cap and fails one above it', async () => {
    const atCap = await resultFor(
      withSeverity('h03-voter-count-after-tool', 1),
      'h03-voter-count-after-tool',
    )
    expect(atCap.checks.severity?.status).toBe('pass')
    const above = await resultFor(
      withSeverity('h03-voter-count-after-tool', 2),
      'h03-voter-count-after-tool',
    )
    expect(above.checks.severity?.status).toBe('fail')
  })

  it('leaves the severity check off a fixture with no cap', async () => {
    const result = await resultFor({}, 'h05-texting-deadline-contradicts-map')
    expect(result.checks.severity).toBeUndefined()
  })

  it('records a scoring call that failed and moves on', async () => {
    const bench = await run({
      scoreTranscript: async () => {
        throw new Error('down')
      },
    })
    expect(bench.scoringErrors).toHaveLength(25)
    expect(bench.results.find((r) => r.id.startsWith('g01-'))?.passed).toBe(
      false,
    )
  })
})

describe('readLocalCaseList', () => {
  it('keeps each condition with its caseId', () => {
    const list = readLocalCaseList('campaign_assistant')
    expect(list.conditions.length).toBeGreaterThan(0)
    for (const { caseId } of list.conditions) {
      expect(list.caseIds.has(caseId)).toBe(true)
    }
  })

  it('reads the judged suite from this checkout', () => {
    const list = readLocalCaseList(
      'chief_of_staff',
      path.join(CASES_DIR, 'no-such-dir'),
    )
    expect(list.caseIds.has('individual-record-refusal')).toBe(true)
    expect(list.caseCount).toBe(list.caseIds.size)
    expect(list.fixtureDescription).toBe('')
  })
})

describe('draftLoaderIssue', () => {
  const draft = {
    caseId: 'a-new-case',
    question: 'A question?',
    condition: 'A condition.',
    handledWhen: 'the reply does the thing.',
    source: 'production' as const,
    split: 'tune' as const,
  }

  it('accepts a valid draft appended to the real list', () => {
    expect(draftLoaderIssue('chief_of_staff', draft)).toBeUndefined()
  })

  it('refuses a caseId already on the list', () => {
    expect(
      draftLoaderIssue('chief_of_staff', { ...draft, caseId: 'control' }),
    ).toContain('repeats caseId')
  })
})

describe('estimateBefore', () => {
  it('covers only scored scopes and bounds itself', () => {
    const estimate = estimateBefore(FIXTURES)
    expect(estimate.expectedCalls).toEqual({ score: 25, draft: 13, gate: 12 })
    expect(estimate.expectedUsd).toBeGreaterThan(0)
    expect(estimate.expectedUsd).toBeLessThan(estimate.worstUsd)
  })
})
