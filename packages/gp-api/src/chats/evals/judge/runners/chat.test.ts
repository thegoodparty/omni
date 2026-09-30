import { PRICING_VERSION } from '../pricing'
import { describe, expect, it } from 'vitest'
import { CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER } from '@/chats/services/chatStream.service'
import { toolBudgetExhaustedNote } from '@/llm/services/llm.service'
import { CiContextSchema } from '../record'
import { TranscriptInputSchema } from '../cases'
import {
  TOOL_BUDGET_FALLBACK_REPLY,
  buildFallbackReplies,
  caseInput,
  ciContextFromEnv,
  classifyChatStatus,
  combineChatStatus,
  joinTurnReplies,
  priceRun,
  reindexTrace,
  tracesUnpriceable,
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
    expect(kinds).not.toContain('question')
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
