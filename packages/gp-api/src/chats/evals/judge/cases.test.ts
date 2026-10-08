import { describe, expect, it } from 'vitest'
import { AGENTS } from './agents'
import { OVERALL } from './judge'
import {
  CaseListError,
  caseJudgingOf,
  caseListPath,
  MAX_CONDITION_CHARS,
  MAX_HANDLED_WHEN_CHARS,
  caseTurns,
  loadCaseList,
  parseCaseList,
  usesSeededTranscript,
  type ChatCase,
} from './cases'

const chatList = (cases: object[]): string =>
  JSON.stringify({ agentId: 'chief_of_staff', shape: 'chat', cases })

const expected = { agentId: 'chief_of_staff', shape: 'chat' } as const

describe('parseCaseList', () => {
  it('reads a chat list', () => {
    const list = parseCaseList(
      'a.json',
      chatList([{ caseId: 'one', question: 'What are my priorities?' }]),
      expected,
    )
    expect(list.cases).toEqual([
      { caseId: 'one', question: 'What are my priorities?' },
    ])
    expect(list.placeholder).toBe(false)
    expect(list.source).toBe('a.json')
  })

  it('reads a background list, whose case carries params', () => {
    const list = parseCaseList(
      'b.json',
      JSON.stringify({
        agentId: 'meeting_briefing',
        shape: 'background',
        cases: [{ caseId: 'one', params: { meetingDate: '2026-01-01' } }],
      }),
      { agentId: 'meeting_briefing', shape: 'background' },
    )
    expect(list.cases).toEqual([
      { caseId: 'one', params: { meetingDate: '2026-01-01' } },
    ])
  })

  it('names the file and the offending case, by index and by id', () => {
    expect(() =>
      parseCaseList(
        'path/to/cos.json',
        chatList([{ caseId: 'fine', question: 'ok' }, { caseId: 'broken' }]),
        expected,
      ),
    ).toThrow(/path\/to\/cos\.json: case 1 \(caseId "broken"\)/)
  })

  it('names the index when the id is not even a string', () => {
    expect(() =>
      parseCaseList(
        'cos.json',
        chatList([{ caseId: 7, question: 'x' }]),
        expected,
      ),
    ).toThrow(/cos\.json: case 0 is not a valid chat case/)
  })

  // A caseId becomes a path segment under _judge/<sweepId>/records/<arm>/, so
  // one carrying a separator would write outside its arm's directory.
  it.each(['../escape', 'has/slash', 'has space', ''])(
    'rejects %o as a caseId',
    (caseId) => {
      expect(() =>
        parseCaseList(
          'cos.json',
          chatList([{ caseId, question: 'x' }]),
          expected,
        ),
      ).toThrow(CaseListError)
    },
  )

  // Two cases under one id collide on the store key: the second overwrites
  // the first, so the sweep silently judges fewer cases than it billed for.
  it('rejects a repeated caseId', () => {
    expect(() =>
      parseCaseList(
        'cos.json',
        chatList([
          { caseId: 'same', question: 'a' },
          { caseId: 'same', question: 'b' },
        ]),
        expected,
      ),
    ).toThrow(/repeats caseId "same"/)
  })

  it('rejects a list filed against the wrong agent', () => {
    expect(() =>
      parseCaseList('cos.json', chatList([{ caseId: 'a', question: 'q' }]), {
        agentId: 'priority_flow',
        shape: 'chat',
      }),
    ).toThrow(/declares agentId "chief_of_staff" but the registry points/)
  })

  // The registry decides which runner drives a file. A chat list filed
  // against a background agent would otherwise fail inside a runner that
  // never mentions this file.
  it('rejects a list whose shape disagrees with the registry', () => {
    expect(() =>
      parseCaseList('cos.json', chatList([{ caseId: 'a', question: 'q' }]), {
        agentId: 'chief_of_staff',
        shape: 'background',
      }),
    ).toThrow(/declares shape "chat" but chief_of_staff is a background/)
  })

  it('rejects a chat case carrying params instead of a question', () => {
    expect(() =>
      parseCaseList(
        'cos.json',
        chatList([{ caseId: 'a', params: {} }]),
        expected,
      ),
    ).toThrow(/is not a valid chat case/)
  })

  it('rejects an empty list, which has nothing to compare', () => {
    expect(() => parseCaseList('cos.json', chatList([]), expected)).toThrow(
      CaseListError,
    )
  })

  it('says the file is not JSON rather than reporting a schema error', () => {
    expect(() => parseCaseList('cos.json', '{ not json', expected)).toThrow(
      /cos\.json: not valid JSON/,
    )
  })

  it('carries placeholder and note through', () => {
    const list = parseCaseList(
      'cos.json',
      JSON.stringify({
        agentId: 'chief_of_staff',
        shape: 'chat',
        placeholder: true,
        note: 'exercises the pipeline only',
        cases: [{ caseId: 'a', question: 'q' }],
      }),
      expected,
    )
    expect(list.placeholder).toBe(true)
    expect(list.note).toBe('exercises the pipeline only')
  })
})

describe('caseListPath', () => {
  it('resolves a name inside the case-list directory', () => {
    expect(caseListPath('cos.json', '/cases')).toBe('/cases/cos.json')
  })

  // A registry string that could address any path would make the case list a
  // file-read primitive.
  it.each(['../../../etc/passwd', '/etc/passwd', '..'])(
    'refuses %o',
    (name) => {
      expect(() => caseListPath(name, '/cases')).toThrow(CaseListError)
    },
  )
})

describe('loadCaseList', () => {
  it('refuses an agent with no case list', () => {
    expect(() =>
      loadCaseList({
        agentId: 'x',
        shape: 'chat',
        cases: null,
        status: 'pending',
      }),
    ).toThrow(/x has no case list yet/)
  })

  // The shipped starter list, read through the real registry entry and the
  // real file. This is what proves the file on disk is loadable — a test that
  // only parsed an inline string would pass with a broken JSON file shipped.
  //
  // The ids are asserted exactly rather than counted. `length >= 2` against a
  // three-case file still passes when one is deleted, and asserting that
  // every case has a `question` only re-states ChatCaseSchema, which
  // `parseCaseList` already enforced — neither could fail.
  it('loads the chief_of_staff starter list off disk', () => {
    const entry = AGENTS.find((a) => a.agentId === 'chief_of_staff')
    if (entry === undefined) throw new Error('chief_of_staff left the registry')
    expect(entry.cases).toBe('chief_of_staff.json')

    const list = loadCaseList(entry)
    expect(list.cases.map((c) => c.caseId)).toEqual([
      'priorities-on-file',
      'constituent-count',
      'product-how-to',
      'capability-inventory-from-context',
      'action-the-agent-cannot-take',
      'individual-record-refusal',
      'rambling-multipart-request',
      'judgement-call-no-single-answer',
    ])
    // Marked as a placeholder, which is what stops its verdict reading as a
    // claim about the agent.
    expect(list.placeholder).toBe(true)
    expect(list.note).toContain('PLACEHOLDER')
  })

  // Every registry entry that names a file must have one that loads: this is
  // what fails when someone adds a `cases` string and forgets the file, or
  // ships one whose agentId does not match its entry.
  //
  // The floor is the point. Without it, a registry that regressed to
  // `cases: null` everywhere would run the loop zero times and pass with no
  // assertions at all — the same shape as the `/\d+ of \d+/` coverage regex
  // this project has already shipped once.
  it('loads every case list the registry names', () => {
    const named = AGENTS.filter((a) => a.cases !== null)
    expect(named.length).toBeGreaterThan(0)
    for (const agent of named) {
      const list = loadCaseList(agent)
      expect(list.agentId, agent.agentId).toBe(agent.agentId)
      expect(list.cases.length, agent.agentId).toBeGreaterThan(0)
    }
  })
})

// The four new case capabilities, at the boundary where a malformed one can
// still name the file it came from. Every field below is optional, so the
// failure these guard against is not "a list stopped parsing" — it is "a
// directive nobody could honour parsed cleanly and drove a paid sweep under a
// condition nobody applied".
describe('a chat case with several user turns', () => {
  const parse = (one: object): ChatCase[] => {
    const list = parseCaseList('a.json', chatList([one]), expected)
    return list.cases as ChatCase[]
  }

  it('accepts an ordered list of user turns', () => {
    expect(parse({ caseId: 'multi', turns: ['first', 'second'] })).toEqual([
      { caseId: 'multi', turns: ['first', 'second'] },
    ])
  })

  it('still accepts a bare question, which is what every list carries', () => {
    expect(parse({ caseId: 'one', question: 'ask' })).toEqual([
      { caseId: 'one', question: 'ask' },
    ])
  })

  // Both would leave which one the agent was asked undecided, and the two
  // arms could resolve it differently.
  it('refuses a case carrying both spellings', () => {
    expect(() =>
      parse({ caseId: 'both', question: 'a', turns: ['a'] }),
    ).toThrow(/exactly one of/)
  })

  it('refuses a case carrying neither', () => {
    expect(() => parse({ caseId: 'none' })).toThrow(/exactly one of/)
  })

  // THE DIRECTIVE'S OWN NAME, which the inner schemas cannot catch. A
  // non-strict case object would strip `priorTranscipt`, run the case with no
  // condition applied, and let the pair compare happily — and both arms would
  // do it, so nothing downstream could notice either.
  it('refuses a misspelled directive rather than dropping it', () => {
    expect(() =>
      parse({
        caseId: 'typo',
        question: 'ask',
        priorTranscipt: [{ role: 'user', content: 'earlier' }],
      }),
    ).toThrow(CaseListError)
    expect(() =>
      parse({ caseId: 'typo2', question: 'ask', tool_failure: {} }),
    ).toThrow(CaseListError)
  })

  it('reads both spellings back as one ordered list', () => {
    expect(caseTurns({ caseId: 'a', question: 'ask' })).toEqual(['ask'])
    expect(caseTurns({ caseId: 'b', turns: ['x', 'y'] })).toEqual(['x', 'y'])
  })

  // The schema guarantees one of the two, but the TYPE has both optional, so
  // a hand-built case can reach here with neither — and an empty list would
  // drive a conversation of no turns and record it as a run.
  it('refuses to read no turns at all out of a hand-built case', () => {
    expect(() => caseTurns({ caseId: 'empty' })).toThrow(CaseListError)
  })
})

describe('a chat case with a seeded prior transcript', () => {
  const parse = (transcript: object[]): ChatCase =>
    parseCaseList(
      'a.json',
      chatList([
        { caseId: 'mid', question: 'and now?', priorTranscript: transcript },
      ]),
      expected,
    ).cases[0] as ChatCase

  it('accepts user and assistant turns, with tool calls on the latter', () => {
    const one = parse([
      { role: 'user', content: 'how many priorities?' },
      {
        role: 'assistant',
        content: 'Three.',
        toolCalls: [{ tool: 'crud_priorities', input: { action: 'list' } }],
      },
    ])
    expect(one.priorTranscript).toHaveLength(2)
    expect(usesSeededTranscript(one)).toBe(true)
  })

  it('marks a case that seeded nothing as not having seeded one', () => {
    expect(usesSeededTranscript({ caseId: 'plain', question: 'ask' })).toBe(
      false,
    )
  })

  // A user row carries no segments in production, so a seeded one that did
  // would be a row no route could have written.
  it('refuses tool calls on a user turn', () => {
    expect(() =>
      parse([
        { role: 'user', content: 'x', toolCalls: [{ tool: 't', input: {} }] },
      ]),
    ).toThrow(/only an assistant turn/)
  })

  it('refuses a turn with neither content nor a tool call', () => {
    expect(() => parse([{ role: 'assistant', content: '  ' }])).toThrow(
      /empty row/,
    )
  })

  // A widget-only assistant turn IS a production shape: it persists with
  // empty content and its tool segments, and the replay drops it.
  it('accepts a widget-only assistant turn', () => {
    const one = parse([
      { role: 'user', content: 'ask' },
      { role: 'assistant', content: '', toolCalls: [{ tool: 't', input: {} }] },
    ])
    expect(one.priorTranscript?.[1]?.content).toBe('')
  })

  // Beside the two recognised keys, so stripping the unknown one leaves a
  // legal call and only `.strict()` refuses it.
  it('refuses a tool-call key nobody defined', () => {
    expect(() =>
      parse([
        {
          role: 'assistant',
          content: 'done',
          toolCalls: [{ tool: 't', input: {}, output: 'invented' }],
        },
      ]),
    ).toThrow(CaseListError)
  })

  // A TRANSCRIPT PRODUCTION COULD HAVE PRODUCED, which is narrower than a
  // list of individually valid rows. `toLlmMessages` folds only the FIRST
  // leading assistant row into the system prompt, so either shape below
  // leaves an assistant row where the provider requires a user one — and
  // that arrives as a stream error after the conversation is open and a
  // paid turn has been attempted.
  it('refuses a transcript that opens on an assistant reply', () => {
    expect(() =>
      parse([
        { role: 'assistant', content: 'Three.' },
        { role: 'user', content: 'which?' },
      ]),
    ).toThrow(/open on a user turn/)
  })

  it('refuses two assistant turns in a row', () => {
    expect(() =>
      parse([
        { role: 'user', content: 'ask' },
        { role: 'assistant', content: 'Three.' },
        { role: 'assistant', content: 'Also this.' },
      ]),
    ).toThrow(/both assistant turns/)
  })

  it('accepts the alternation a conversation actually produces', () => {
    const one = parse([
      { role: 'user', content: 'ask' },
      { role: 'assistant', content: 'Three.' },
      { role: 'user', content: 'which?' },
      { role: 'assistant', content: 'Housing.' },
    ])
    expect(one.priorTranscript).toHaveLength(4)
  })

  it('refuses a transcript key nobody defined', () => {
    expect(() =>
      parse([{ role: 'user', content: 'x', tool_calls: [] }]),
    ).toThrow(CaseListError)
  })
})

describe('a chat case with a tool-failure directive', () => {
  const parse = (failure: object): ChatCase =>
    parseCaseList(
      'a.json',
      chatList([{ caseId: 'fail', question: 'ask', toolFailure: failure }]),
      expected,
    ).cases[0] as ChatCase

  it('accepts a thrown error and a timeout', () => {
    expect(parse({ tool: 'get_briefing', mode: 'error' }).toolFailure).toEqual({
      tool: 'get_briefing',
      mode: 'error',
    })
    expect(
      parse({ tool: 'get_briefing', mode: 'timeout', afterMs: 25 }).toolFailure,
    ).toEqual({ tool: 'get_briefing', mode: 'timeout', afterMs: 25 })
  })

  it('refuses a failure mode nobody implemented', () => {
    expect(() => parse({ tool: 't', mode: 'flake' })).toThrow(CaseListError)
  })

  // An "error" step throws before the real execute is reached, so a delay on
  // it is a field the author believed did something.
  it('refuses afterMs on a thrown error', () => {
    expect(() => parse({ tool: 't', mode: 'error', afterMs: 10 })).toThrow(
      /only means something for mode "timeout"/,
    )
  })

  it('refuses a tool-failure key nobody defined', () => {
    expect(() => parse({ tool: 't', mode: 'error', retries: 2 })).toThrow(
      CaseListError,
    )
  })
})

describe('a chat case with an account-state directive', () => {
  const parse = (state: object): ChatCase =>
    parseCaseList(
      'a.json',
      chatList([{ caseId: 'state', question: 'ask', accountState: state }]),
      expected,
    ).cases[0] as ChatCase

  it('accepts the four states that gate a tool', () => {
    expect(
      parse({
        pro: false,
        district: false,
        campaignDetails: false,
        ordinanceStep: 'draft',
      }).accountState,
    ).toEqual({
      pro: false,
      district: false,
      campaignDetails: false,
      ordinanceStep: 'draft',
    })
  })

  // THE CLOSED SET IS THE POINT. An open bag of column overrides would let a
  // case list seed a state no deployment can produce, and the verdict would
  // be about an agent we do not ship.
  // BESIDE A RECOGNISED KEY, on purpose. A non-strict object strips the
  // unknown one, which would leave `{}` and trip the empty-state refine — so
  // `{ isAdmin: true }` alone throws whether or not the set is closed, and a
  // test written that way passes with `.strict()` removed. With `pro` there
  // too the stripped object is a legal state and only `.strict()` refuses it.
  it('refuses a state nobody defined rather than ignoring it', () => {
    expect(() => parse({ pro: false, isAdmin: true })).toThrow(CaseListError)
  })

  it('refuses a misspelling of a state it does define', () => {
    expect(() => parse({ district: false, isPro: false })).toThrow(
      CaseListError,
    )
  })

  it('accepts the briefing highlight, and only as a boolean', () => {
    expect(parse({ briefingHighlight: true }).accountState).toEqual({
      briefingHighlight: true,
    })
    expect(() => parse({ briefingHighlight: 'yes' })).toThrow(CaseListError)
  })

  it('refuses an ordinance step that is not one of the flow steps', () => {
    expect(() => parse({ ordinanceStep: 'drafting' })).toThrow(CaseListError)
  })

  // Declaring nothing is not the same as asking for the default, and a reader
  // of the record could not tell the two apart.
  it('refuses an empty state', () => {
    expect(() => parse({})).toThrow(/omit the field/)
  })
})

describe('a background case with dimensions of its own', () => {
  const background = {
    agentId: 'meeting_briefing',
    shape: 'background',
  } as const
  const parse = (cases: object[]) =>
    parseCaseList(
      'd.json',
      JSON.stringify({ ...background, cases }),
      background,
    )
  const probe = (dimensions: object[], caseId = 'one') => ({
    caseId,
    params: { meetingDate: '2026-01-01' },
    dimensions,
  })
  const sparse = { name: 'sparse_handling', question: 'Is the gap named?' }

  it('reads them', () => {
    expect(parse([probe([sparse])]).cases).toEqual([probe([sparse])])
  })

  // The one name scoring and the verdict already use, held here as a literal
  // because judge.ts imports cases.ts.
  it.each(['task_success', 'user_utility', OVERALL])(
    'refuses %s, a dimension every case already has',
    (name) => {
      expect(() => parse([probe([{ name, question: 'q' }])])).toThrow(
        /already a dimension every case is judged on/,
      )
    },
  )

  it.each(['Sparse', '__proto__', 'two words', ''])(
    'refuses %j, which cannot be a schema key and a report row',
    (name) => {
      expect(() => parse([probe([{ name, question: 'q' }])])).toThrow(
        /snake_case identifier/,
      )
    },
  )

  it('refuses a name asked twice in one case', () => {
    expect(() => parse([probe([sparse, sparse])])).toThrow(
      /names each of its dimensions once/,
    )
  })

  it('refuses more than four', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      name,
      question: 'q',
    }))
    expect(() => parse([probe(many)])).toThrow(/dimensions: .*<=4/)
  })

  it('refuses a misspelled field inside one', () => {
    expect(() => parse([probe([{ ...sparse, qustion: 'typo' }])])).toThrow(
      /qustion/,
    )
  })

  it('lets two cases share a dimension that asks the same question', () => {
    expect(
      parse([probe([sparse], 'one'), probe([sparse], 'two')]).cases,
    ).toHaveLength(2)
  })

  it('refuses one name asking two questions across cases', () => {
    expect(() =>
      parse([
        probe([sparse], 'one'),
        probe([{ ...sparse, question: 'Something else?' }], 'two'),
      ]),
    ).toThrow(/case 1 asks dimension "sparse_handling" a different question/)
  })
})

// Melecia's two per-case fields. Both are for the judging step only; the
// runner dispatches `params` and nothing else.
describe('a background case condition and scored flag', () => {
  const backgroundList = (cases: object[]): string =>
    JSON.stringify({ agentId: 'meeting_briefing', shape: 'background', cases })
  const parse = (cases: object[]) =>
    parseCaseList('b.json', backgroundList(cases), {
      agentId: 'meeting_briefing',
      shape: 'background',
    })

  it('reads both, and defaults a case to scored with no condition', () => {
    const list = parse([
      { caseId: 'probe', params: {}, condition: '  Source 3 is stale.  ' },
      { caseId: 'control', params: {}, scored: false },
      { caseId: 'plain', params: {} },
    ])
    expect([...caseJudgingOf(list)]).toEqual([
      ['probe', { condition: 'Source 3 is stale.', scored: true }],
      ['control', { scored: false }],
      ['plain', { scored: true }],
    ])
  })

  // Stripped instead, a misspelled flag would score the control as an
  // ordinary case and nothing downstream could tell.
  it('refuses a misspelled field rather than dropping it', () => {
    expect(() => parse([{ caseId: 'c', params: {}, scorred: false }])).toThrow(
      /case 0 \(caseId "c"\).*scorred/,
    )
  })

  it('refuses an empty or oversized condition', () => {
    expect(() =>
      parse([{ caseId: 'c', params: {}, condition: '   ' }]),
    ).toThrow(CaseListError)
    expect(() =>
      parse([
        {
          caseId: 'c',
          params: {},
          condition: 'x'.repeat(MAX_CONDITION_CHARS + 1),
        },
      ]),
    ).toThrow(CaseListError)
  })

  it('reads a handling sentence beside its condition', () => {
    const list = parse([
      {
        caseId: 'probe',
        params: {},
        condition: 'Source 3 is stale.',
        handledWhen: ' the run dates the claim or drops it. ',
      },
    ])
    expect(caseJudgingOf(list).get('probe')).toEqual({
      condition: 'Source 3 is stale.',
      handledWhen: 'the run dates the claim or drops it.',
      scored: true,
    })
  })

  // A sentence about handling a condition the case does not have, or on the
  // zero reading, would hand the judge a question with no honest answer.
  it.each([
    [{ caseId: 'c', params: {}, handledWhen: 'it says so' }],
    [
      {
        caseId: 'c',
        params: {},
        condition: 'x',
        scored: false,
        handledWhen: 'it says so',
      },
    ],
    [
      {
        caseId: 'c',
        params: {},
        condition: 'x',
        handledWhen: 'x'.repeat(MAX_HANDLED_WHEN_CHARS + 1),
      },
    ],
  ])('refuses a misplaced or oversized handling sentence', (one) => {
    expect(() => parse([one])).toThrow(CaseListError)
  })

  it('yields nothing for a chat list', () => {
    const list = parseCaseList(
      'a.json',
      chatList([{ caseId: 'one', question: 'What are my priorities?' }]),
      expected,
    )
    expect(caseJudgingOf(list).size).toBe(0)
  })
})
