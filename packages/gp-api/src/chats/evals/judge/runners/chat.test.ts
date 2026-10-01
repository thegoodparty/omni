import { PRICING_VERSION } from '../pricing'
import { describe, expect, it } from 'vitest'
import { CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER } from '@/chats/services/chatStream.service'
import { toolBudgetExhaustedNote } from '@/llm/services/llm.service'
import { CiContextSchema } from '../record'
import {
  MAX_TOOL_TIMEOUT_MS,
  ToolFailureSchema,
  toolFailureDelayMs,
  TranscriptInputSchema,
} from '../cases'
import {
  TOOL_BUDGET_FALLBACK_REPLY,
  buildFallbackReplies,
  caseInput,
  ciContextFromEnv,
  classifyChatStatus,
  combineChatStatus,
  directiveFailureText,
  everyTurnPriced,
  joinTurnReplies,
  priceRun,
  reindexTrace,
  tracesUnpriceable,
  turnTokens,
  unpriceableStep,
} from './chat'

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars

describe('pricing a run', () => {
  const tokens = { input: 31_213, output: 227, cacheRead: 0, cacheWrite: 0 }

  it('prices a model the table knows', () => {
    const priced = priceRun(tokens, 'claude-sonnet-4-6')
    expect(priced.cost?.usdAtCapture).toBeCloseTo(0.097, 3)
    expect(priced.cost?.pricingVersion).toBe(PRICING_VERSION)
    expect(priced.unpriceable).toBeUndefined()
  })

  // Every chat scope declares a claude-opus-4-7 fallback that pricing.ts has
  // no rates for, so this is a live path and not a hypothetical.
  it('omits cost for a model it cannot price, rather than storing zero', () => {
    const priced = priceRun(tokens, 'claude-opus-4-7')
    expect(priced.cost).toBeUndefined()
    expect(priced.unpriceable).toMatch(/claude-opus-4-7/)
  })

  // A stored 0 under a real pricing version reads as "this run was free",
  // and sharesPricing would call two arms comparably priced when one was
  // never priced at all.
  it('never reports an unpriceable run as costing nothing', () => {
    const priced = priceRun(tokens, 'claude-opus-4-7')
    expect(priced.cost?.usdAtCapture).not.toBe(0)
  })
})

describe('TOOL_BUDGET_FALLBACK_REPLY', () => {
  it('is still the reply the tool-budget note instructs', () => {
    // The runner reads this reply as `blocked`. If the note is reworded and
    // this copy is not, a turn that ran out of tool budget silently reads as
    // a produced answer instead.
    expect(String(toolBudgetExhaustedNote.content)).toContain(
      TOOL_BUDGET_FALLBACK_REPLY,
    )
  })
})

describe('buildFallbackReplies', () => {
  it('always treats the tool-budget fallback as one', () => {
    expect(buildFallbackReplies()).toEqual([TOOL_BUDGET_FALLBACK_REPLY])
  })

  it('keeps what the case list declared', () => {
    const declined = 'I cannot break constituents down by political party.'
    expect(buildFallbackReplies([declined])).toContain(declined)
  })

  // `includes('')` is true of every string, so one blank entry in a case list
  // would mark every run in the sweep blocked.
  it('does not let a blank case entry mark every run blocked', () => {
    expect(
      classifyChatStatus(
        'Three priorities.',
        false,
        buildFallbackReplies(['', '   ']),
      ),
    ).toBe('produced')
  })
})

describe('classifyChatStatus', () => {
  it('reads an ordinary answer as an agent result', () => {
    expect(classifyChatStatus('Three priorities.', false, [])).toBe('produced')
  })

  it('reads a stream error as infrastructure, never as a result', () => {
    expect(classifyChatStatus('partial text', true, [])).toBe('infraError')
  })

  it('reads a missing assistant turn as infrastructure', () => {
    expect(classifyChatStatus(null, false, [])).toBe('infraError')
  })

  it('reads the interrupted sentinel as infrastructure', () => {
    expect(
      classifyChatStatus(CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER, false, []),
    ).toBe('infraError')
  })

  it('reads an empty answer as infrastructure', () => {
    expect(classifyChatStatus('   \n ', false, [])).toBe('infraError')
  })

  it('reads the tool-budget fallback as blocked, keeping its output', () => {
    expect(
      classifyChatStatus(TOOL_BUDGET_FALLBACK_REPLY, false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('blocked')
  })

  it('reads a case-declared refusal as blocked', () => {
    const declined = 'I cannot break constituents down by political party.'
    expect(classifyChatStatus(`Sure. ${declined}`, false, [declined])).toBe(
      'blocked',
    )
  })

  it('does not read an unlisted refusal as blocked', () => {
    expect(
      classifyChatStatus('I would rather not answer that.', false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('produced')
  })
})

describe('ciContextFromEnv', () => {
  it('is absent on a local run', () => {
    expect(ciContextFromEnv(env({}))).toBeUndefined()
  })

  it('is absent when the run identifiers are incomplete', () => {
    expect(
      ciContextFromEnv(env({ GITHUB_REPOSITORY: 'thegoodparty/omni' })),
    ).toBeUndefined()
  })

  it('takes the PR number from the merge ref', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '36592029654',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REF: 'refs/pull/2198/merge',
      }),
    )

    expect(CiContextSchema.parse(ci)).toEqual({
      repo: 'thegoodparty/omni',
      prNumber: 2198,
      workflowRunId: '36592029654',
      workflowRunAttempt: 1,
      workflowRunUrl:
        'https://github.com/thegoodparty/omni/actions/runs/36592029654',
    })
  })

  it('falls back to PR_NUMBER when the ref is not a pull ref', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '1',
        GITHUB_REF: 'refs/heads/universal-judge',
        PR_NUMBER: '2198',
      }),
    )
    expect(ci?.prNumber).toBe(2198)
  })

  it('carries no PR number for a sweep dispatched without one', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '1',
        GITHUB_REF: 'refs/heads/universal-judge',
      }),
    )
    expect(ci?.prNumber).toBeUndefined()
    expect(CiContextSchema.safeParse(ci).success).toBe(true)
  })

  it('points a re-run at the attempt that produced it', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '7',
        GITHUB_RUN_ATTEMPT: '3',
      }),
    )
    expect(ci?.workflowRunAttempt).toBe(3)
    expect(ci?.workflowRunUrl).toBe(
      'https://github.com/thegoodparty/omni/actions/runs/7/attempts/3',
    )
  })
})

// This guard has shipped wrong in both directions: once storing a confident $0
// for a run whose cost was unknown, and once stacking a generic "usage never
// resolved" step behind the specific rejection message that had already been
// traced.
describe('the unpriceable trace step', () => {
  it('records an unpriceable model on a run that otherwise succeeded', () => {
    expect(tracesUnpriceable('no rate for X', 'produced', false)).toBe(true)
  })

  it('records it on a blocked run too, which is an agent result', () => {
    expect(tracesUnpriceable('no rate for X', 'blocked', false)).toBe(true)
  })

  it('stays silent when there is nothing unpriceable to say', () => {
    expect(tracesUnpriceable(undefined, 'produced', false)).toBe(false)
  })

  // The trace already says why the turn ended.
  it('does not restate an infraError the trace already carries', () => {
    expect(tracesUnpriceable('usage never resolved', 'infraError', false)).toBe(
      false,
    )
  })

  // The inner catch already put the rejection's own message in the trace, and
  // that message names the actual failure where this one only says usage did
  // not resolve.
  it('does not stack behind a usage error already traced', () => {
    expect(tracesUnpriceable('usage never resolved', 'produced', true)).toBe(
      false,
    )
  })

  // The step carries the reason itself, never a stand-in for it: the trace
  // step schema requires a non-empty string, so an empty one would make
  // RunRecordSchema.parse throw away a completed, judgeable run.
  it('carries the reason the run could not be priced', () => {
    expect(
      unpriceableStep({ unpriceable: 'no rate for X' }, 'produced', false),
    ).toBe('no rate for X')
  })

  it('carries nothing when there is nothing unpriceable to say', () => {
    expect(
      unpriceableStep({ cost: undefined }, 'produced', false),
    ).toBeUndefined()
  })
})

// ONE STATUS FOR A CONVERSATION. A case that broke on its second turn is not
// a case the judge can read half of.
describe('combineChatStatus', () => {
  it("is the single turn's status for a one-turn case", () => {
    expect(combineChatStatus(['produced'])).toBe('produced')
    expect(combineChatStatus(['blocked'])).toBe('blocked')
    expect(combineChatStatus(['infraError'])).toBe('infraError')
  })

  // A broken turn means the conversation the case authored did not happen:
  // the later turns were answered against a history missing a reply.
  it('reports a broken turn however well the rest went', () => {
    expect(combineChatStatus(['produced', 'infraError', 'produced'])).toBe(
      'infraError',
    )
  })

  // A refusal is a RESULT and stays judgeable — but a conversation that had
  // to recover from one is the behavior being compared, so it keeps the mark.
  it('reports a fallback turn even when a later turn recovered', () => {
    expect(combineChatStatus(['blocked', 'produced'])).toBe('blocked')
  })

  it('prefers the broken turn over the declined one', () => {
    expect(combineChatStatus(['blocked', 'infraError'])).toBe('infraError')
  })

  // No turn driven is never a result, and a record with no output is exactly
  // what infraError means.
  it('reports no turns at all as infraError', () => {
    expect(combineChatStatus([])).toBe('infraError')
  })
})

describe('joinTurnReplies', () => {
  // A one-turn record has to stay byte-identical to what it was before any
  // of this: nineteen case lists produce one, and a label on it would show
  // up as a difference in every stored output.
  it('leaves a single reply exactly as it was', () => {
    expect(joinTurnReplies(['You have three priorities.'])).toBe(
      'You have three priorities.',
    )
  })

  // Labelled because a reply can itself contain blank lines, which makes an
  // unlabelled join ambiguous about where one turn ended.
  it('labels each reply of a conversation', () => {
    expect(joinTurnReplies(['first', 'second\n\nwith a gap'])).toBe(
      '[turn 1]\nfirst\n\n[turn 2]\nsecond\n\nwith a gap',
    )
  })

  it('keeps the replies in the order they were given', () => {
    expect(joinTurnReplies(['a', 'b', 'c'])).toMatch(
      /\[turn 1\]\na\n\n\[turn 2\]\nb\n\n\[turn 3\]\nc/,
    )
  })
})

describe('reindexTrace', () => {
  // Several turns' traces each start at zero. Concatenated unchanged, the
  // record would carry two step 0s and a reader could not order them.
  it("renumbers two turns' steps as one sequence", () => {
    expect(
      reindexTrace([
        { index: 0, kind: 'text' },
        { index: 1, kind: 'tool', tool: 'a' },
        { index: 0, kind: 'text' },
      ]).map((step) => step.index),
    ).toEqual([0, 1, 2])
  })

  it('changes nothing else about a step', () => {
    expect(
      reindexTrace([{ index: 7, kind: 'tool', tool: 'a', error: 'boom' }]),
    ).toEqual([{ index: 0, kind: 'tool', tool: 'a', error: 'boom' }])
  })
})

// THE INPUT PAYLOAD IS THE CROSS-CHECKOUT GUARD. An older base ref parses a
// newer candidate's case list with its own copy of the schema, strips the
// field it does not know, and drives a plainer run. What stops that being
// compared and reported as a verdict is that the two arms' inputs no longer
// match, and `blindCase` refuses the pair.
describe('caseInput', () => {
  it('records a plain question exactly as it always has', () => {
    expect(
      caseInput({ caseId: 'a', question: 'What are my priorities?' }),
    ).toEqual({ kind: 'question', value: 'What are my priorities?' })
  })

  it('records a different payload for every new field', () => {
    const kinds = [
      caseInput({ caseId: 'a', turns: ['one', 'two'] }),
      caseInput({
        caseId: 'a',
        question: 'q',
        priorTranscript: [{ role: 'user', content: 'earlier' }],
      }),
      caseInput({
        caseId: 'a',
        question: 'q',
        toolFailure: { tool: 't', mode: 'error' },
      }),
      caseInput({ caseId: 'a', question: 'q', accountState: { pro: false } }),
    ].map((payload) => payload.kind)

    expect(kinds).toEqual([
      'transcript',
      'transcript',
      'transcript',
      'transcript',
    ])
  })

  // THE WRITER AND THE SCHEMA CANNOT DRIFT. `caseInput` lists the fields by
  // hand, so a field added to the case schema and forgotten here would be
  // absent from the payload, absent from the rendered input, and therefore
  // invisible to the mismatch refusal that is the whole cross-checkout
  // protection. This is what fails when that happens.
  it('carries every field the transcript payload names', () => {
    const payload = caseInput({
      caseId: 'a',
      turns: ['one'],
      priorTranscript: [{ role: 'user', content: 'earlier' }],
      toolFailure: { tool: 't', mode: 'error' },
      accountState: { pro: false },
    })
    const value = TranscriptInputSchema.parse(payload.value)

    expect(Object.keys(value).sort()).toEqual(
      Object.keys(TranscriptInputSchema.shape).sort(),
    )
  })

  // One schema for the writer here and the reader in normalize.ts. A writer
  // and a reader that described the shape separately would drift, and the
  // record crosses two checkouts — so the drift would arrive as a comparison
  // refused for the wrong reason.
  it('writes a value the shared transcript schema accepts', () => {
    const payload = caseInput({
      caseId: 'a',
      turns: ['one', 'two'],
      priorTranscript: [
        { role: 'user', content: 'earlier' },
        {
          role: 'assistant',
          content: 'Three.',
          toolCalls: [{ tool: 'crud_priorities', input: { action: 'list' } }],
        },
      ],
      toolFailure: { tool: 'crud_priorities', mode: 'timeout', afterMs: 20 },
      accountState: { pro: false, district: false },
    })

    const parsed = TranscriptInputSchema.safeParse(payload.value)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(parsed.data?.turns).toEqual(['one', 'two'])
    expect(parsed.data?.seededTranscript).toHaveLength(2)
    expect(parsed.data?.toolFailure?.afterMs).toBe(20)
    expect(parsed.data?.accountState).toEqual({ pro: false, district: false })
  })

  // A one-turn case that carries a directive still records `turns`, so the
  // two spellings do not produce two shapes for the reader to handle.
  it('always records the turns as a list', () => {
    const payload = caseInput({
      caseId: 'a',
      question: 'just the one',
      accountState: { pro: false },
    })
    expect(TranscriptInputSchema.parse(payload.value).turns).toEqual([
      'just the one',
    ])
  })
})

// How long a forced timeout waits. Untested, the runner honoured whatever
// this returned and nothing noticed if it stopped reading the case's own
// number — the timing test at the seam passes on the default too, only
// slower.
describe('toolFailureDelayMs', () => {
  it('uses the delay the case asked for', () => {
    expect(
      toolFailureDelayMs({ tool: 't', mode: 'timeout', afterMs: 2_500 }),
    ).toBe(2_500)
  })

  // Short by default, because this reproduces the OUTCOME of a timeout and
  // not a real wall-clock hang.
  it('is short when the case named no delay', () => {
    const delay = toolFailureDelayMs({ tool: 't', mode: 'timeout' })
    expect(delay).toBeGreaterThan(0)
    expect(delay).toBeLessThan(1_000)
  })

  // An `error` step throws before the real execute is reached, so there is
  // nothing to wait for.
  it('waits for nothing on a thrown error', () => {
    expect(toolFailureDelayMs({ tool: 't', mode: 'error' })).toBe(0)
  })

  // A case list is authored text, and a directive that waited minutes would
  // be indistinguishable from a wedged sweep.
  it('has a bound a case list cannot exceed', () => {
    expect(() =>
      ToolFailureSchema.parse({
        tool: 't',
        mode: 'timeout',
        afterMs: MAX_TOOL_TIMEOUT_MS + 1,
      }),
    ).toThrow()
    expect(
      ToolFailureSchema.parse({
        tool: 't',
        mode: 'timeout',
        afterMs: MAX_TOOL_TIMEOUT_MS,
      }).afterMs,
    ).toBe(MAX_TOOL_TIMEOUT_MS)
  })
})

// A PARTIAL SUM IS NOT THE CONVERSATION'S USAGE. A three-turn case whose
// third turn never reported has a real total nobody measured, and recording
// what the first two cost reads as the whole conversation — the same "cheaper
// than it was" reading the absent-rather-than-zero rule exists to prevent.
// Zero is what a single unreported turn already recorded before any of this,
// so it is the existing convention rather than a new one; the trace carries
// the reason, and TokenUsageSchema's four non-optional ints cannot say
// "unknown" (the follow-up the README records).
describe('turnTokens', () => {
  const ONE_TURN = ['a']
  const THREE_TURNS = ['a', 'b', 'c']

  it('records what was measured when every turn reported', () => {
    expect(turnTokens({ input: 350, output: 30 }, 3, THREE_TURNS)).toEqual({
      input: 350,
      output: 30,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('records nothing when a turn went unreported', () => {
    expect(turnTokens({ input: 350, output: 30 }, 2, THREE_TURNS)).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('records nothing when no turn reported at all', () => {
    expect(turnTokens(undefined, 0, ONE_TURN).input).toBe(0)
  })

  // A turn that really did use nothing reports a true zero, which is an
  // observation and has to survive.
  it('keeps a measured zero', () => {
    expect(turnTokens({ input: 0, output: 0 }, 1, ONE_TURN)).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  // Zero because prompt caching is not enabled. Carried rather than omitted
  // so the day it is switched on, pricing fails loudly instead of costing a
  // cache read at the full input rate.
  it('always carries the cache fields', () => {
    const tokens = turnTokens({ input: 1, output: 1 }, 1, ONE_TURN)
    expect(tokens.cacheRead).toBe(0)
    expect(tokens.cacheWrite).toBe(0)
  })
})

describe('everyTurnPriced', () => {
  it('is true when as many turns reported as were asked for', () => {
    expect(everyTurnPriced(2, ['a', 'b'])).toBe(true)
  })

  // Counted against the turns the case ASKED FOR, not the ones that
  // completed, which is what makes a conversation that broke on its third
  // turn unpriceable instead of priced at what its first two turns cost.
  it('is false when a turn the case asked for never reported', () => {
    expect(everyTurnPriced(2, ['a', 'b', 'c'])).toBe(false)
  })
})

// BOTH REASONS, NOT ONE INSTEAD OF THE OTHER. The seam refuses a directive
// before the model is called, so a run that ALSO failed to complete failed
// for a second, independent reason — and reporting only the directive sends
// the reader to fix a case list when the turn never reached the app.
describe('directiveFailureText', () => {
  it('names the directive when that is all that went wrong', () => {
    expect(
      directiveFailureText('chief_of_staff', 'one', 'no such tool: x'),
    ).toBe('chief_of_staff/one: no such tool: x')
  })

  it('keeps the run failure beside the directive', () => {
    const text = directiveFailureText(
      'chief_of_staff',
      'one',
      'no such tool: x',
      'Error: POST /v1/chats/:id/messages returned 502',
    )
    expect(text).toContain('no such tool: x')
    expect(text).toContain('returned 502')
  })
})
