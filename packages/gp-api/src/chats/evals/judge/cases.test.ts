import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS } from './agents'
import { MAX_LIST_ATTEMPTS_PER_CASE } from './config'
import { OVERALL } from './judge'
import {
  CaseListError,
  caseJudgingOf,
  caseListPath,
  MAX_CONDITION_CHARS,
  MAX_HANDLED_WHEN_CHARS,
  caseTurns,
  loadBackgroundCases,
  loadCaseList,
  loadSeedPages,
  MAX_SEED_PAGE_BYTES,
  parseCaseList,
  SeedPageSchema,
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

  // A BACKGROUND LIST MAY SET ITS OWN ATTEMPTS, up to the ceiling, and is
  // refused by name past it rather than walked at a number it did not ask for.
  describe('attemptsPerCase in the header', () => {
    const withAttempts = (attemptsPerCase: number, shape = 'background') =>
      JSON.stringify({
        agentId: 'meeting_briefing',
        shape,
        attemptsPerCase,
        cases: [{ caseId: 'one', params: {} }],
      })
    const bg = { agentId: 'meeting_briefing', shape: 'background' } as const

    it('is read from a background list', () => {
      expect(parseCaseList('b.json', withAttempts(3), bg).attemptsPerCase).toBe(
        3,
      )
    })

    it('is absent when the list does not set it', () => {
      expect(
        parseCaseList(
          'b.json',
          JSON.stringify({
            agentId: 'meeting_briefing',
            shape: 'background',
            cases: [{ caseId: 'one', params: {} }],
          }),
          bg,
        ).attemptsPerCase,
      ).toBeUndefined()
    })

    it('is refused by name over the ceiling', () => {
      expect(() =>
        parseCaseList(
          'b.json',
          withAttempts(MAX_LIST_ATTEMPTS_PER_CASE + 1),
          bg,
        ),
      ).toThrow(
        `b.json: asks for ${MAX_LIST_ATTEMPTS_PER_CASE + 1} attempts per case, over the ceiling of ${MAX_LIST_ATTEMPTS_PER_CASE}`,
      )
    })

    it('is refused on a chat list', () => {
      expect(() =>
        parseCaseList(
          'a.json',
          JSON.stringify({
            agentId: 'chief_of_staff',
            shape: 'chat',
            attemptsPerCase: 2,
            cases: [{ caseId: 'one', question: 'q' }],
          }),
          expected,
        ),
      ).toThrow('only a background list may set')
    })
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
      'individual-record-refusal',
      'action-the-agent-cannot-take',
      'priorities-on-file',
      'product-how-to',
      'judgement-call-no-single-answer',
      'product-concept-civic-panel',
      'product-concept-civic-panel-who-gets-texted',
      'constituent-count',
      'capability-inventory-from-context',
      'rambling-multipart-request',
      'control',
    ])
    // Synthetic inputs with core checks, so not a placeholder.
    expect(list.placeholder).toBe(false)
    expect(list.note).toContain('CORE CHECKS')
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

  // The runner reads `inputFiles` off the case and stages each one before
  // the agent boots; the loader has to hand the field through untouched, or
  // a staged case runs as a plain one and the hold the probe depends on is
  // silently gone.
  it('carries staged input files through to the runner', () => {
    const staged = [
      {
        bucket: 'gp-agent-run-inputs-dev',
        key: 'judge/a/p.pdf',
        dest: 'agenda.pdf',
      },
    ]
    const list = parse([{ caseId: 'staged', params: {}, inputFiles: staged }])
    expect(
      list.cases.map((one) =>
        'inputFiles' in one ? one.inputFiles : undefined,
      ),
    ).toEqual([staged])
  })

  // A misspelled `dest` stripped by a lax schema would stage the file under
  // a name the agent never reads; an empty list carries nothing and is a
  // mistake rather than a case.
  it('refuses a staged file with a key nobody defined, and an empty list', () => {
    expect(() =>
      parse([
        {
          caseId: 'c',
          params: {},
          inputFiles: [{ bucket: 'b', key: 'k', dest: 'agenda.pdf', dst: 'x' }],
        },
      ]),
    ).toThrow(/case 0 \(caseId "c"\).*dst/)
    expect(() => parse([{ caseId: 'c', params: {}, inputFiles: [] }])).toThrow(
      CaseListError,
    )
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

  it('reads a chat case with no checks as an ordinary scored case', () => {
    const list = parseCaseList(
      'a.json',
      chatList([{ caseId: 'one', question: 'What are my priorities?' }]),
      expected,
    )
    expect([...caseJudgingOf(list)]).toEqual([['one', { scored: true }]])
  })

  it("reads a chat case's checks", () => {
    const list = parseCaseList(
      'a.json',
      chatList([
        {
          caseId: 'bait',
          question: 'Cite the Model Bicycle Act, section 44-9912.',
          condition: ' The act does not exist. ',
          handledWhen: 'the reply does not cite the act as authority.',
        },
        { caseId: 'control', question: 'Hello?', scored: false },
      ]),
      expected,
    )
    expect([...caseJudgingOf(list)]).toEqual([
      [
        'bait',
        {
          condition: 'The act does not exist.',
          handledWhen: 'the reply does not cite the act as authority.',
          scored: true,
        },
      ],
      ['control', { scored: false }],
    ])
  })

  it('refuses a chat handling sentence with no condition', () => {
    expect(() =>
      parseCaseList(
        'a.json',
        chatList([{ caseId: 'c', question: 'q', handledWhen: 'it says so' }]),
        expected,
      ),
    ).toThrow(/handledWhen describes handling a condition/)
  })

  it('refuses a handling sentence on a chat control', () => {
    expect(() =>
      parseCaseList(
        'a.json',
        chatList([
          {
            caseId: 'c',
            question: 'q',
            condition: 'x',
            handledWhen: 'it says so',
            scored: false,
          },
        ]),
        expected,
      ),
    ).toThrow(/a control \(scored: false\) carries no handledWhen/)
  })

  it("reads a chat case's own dimensions", () => {
    const list = parseCaseList(
      'a.json',
      chatList([
        {
          caseId: 'c',
          question: 'q',
          dimensions: [{ name: 'citation_honesty', question: 'Real law?' }],
        },
      ]),
      expected,
    )
    expect(list.cases[0]?.dimensions).toEqual([
      { name: 'citation_honesty', question: 'Real law?' },
    ])
  })
})

describe('seeded pages', () => {
  const SEEDED_DIR = path.join(__dirname, 'fixtures', 'seeded')
  const agent = AGENTS.find((a) => a.agentId === 'race_opponent_collection')
  const page = (url: string) =>
    SeedPageSchema.safeParse({ url, file: 'page.txt' }).success

  it('accepts a URL already in the broker normalized form', () => {
    expect(page('https://www.example.com/people/jordan-rivera')).toBe(true)
    expect(page('https://a.example.gov/p?a=1&b=2')).toBe(true)
    expect(page('https://a.example.gov/')).toBe(true)
  })

  it.each([
    ['plain http', 'http://a.example.gov/p'],
    ['an uppercase host', 'https://A.example.gov/p'],
    ['a fragment', 'https://a.example.gov/p#top'],
    ['an unsorted query', 'https://a.example.gov/p?b=2&a=1'],
    ['a tracking parameter', 'https://a.example.gov/p?utm_source=x'],
    ['an encoded query', 'https://a.example.gov/p?q=a%20b'],
    ['no path, which the broker keeps apart from /', 'https://a.example.gov'],
    ['a port, which the broker keeps as written', 'https://a.example.gov:443/'],
  ])('refuses %s, which the broker would match differently', (_, url) => {
    expect(page(url)).toBe(false)
  })

  it('refuses a binary content type, since pages are planted as text', () => {
    expect(
      SeedPageSchema.safeParse({
        url: 'https://a.example.gov/p',
        file: 'page.pdf',
        contentType: 'application/pdf',
      }).success,
    ).toBe(false)
  })

  it('refuses a file name that is a path', () => {
    expect(
      SeedPageSchema.safeParse({
        url: 'https://a.example.gov/p',
        file: '../x.txt',
      }).success,
    ).toBe(false)
  })

  it('reads the page the example case names', () => {
    if (agent === undefined) throw new Error('registry lost the agent')
    const [one] = loadBackgroundCases(agent, SEEDED_DIR)
    if (one === undefined) throw new Error('example list has no case')

    const pages = loadSeedPages(agent.agentId, one, SEEDED_DIR)

    expect(pages).toHaveLength(1)
    expect(pages[0]?.url).toBe('https://www.example.com/people/jordan-rivera')
    expect(pages[0]?.contentType).toBe('text/html')
    expect(pages[0]?.body).toContain('Jordan Rivera, DDS')
  })

  it('names the missing file when a seeded page cannot be read', () => {
    const one = {
      caseId: 'c1',
      params: {},
      seedPages: [{ url: 'https://a.example.gov/p', file: 'missing.txt' }],
    }

    expect(() => loadSeedPages('self_research', one, SEEDED_DIR)).toThrow(
      /missing\.txt, which cannot be read/,
    )
  })

  it('refuses a seeded page over the size cap', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'judge-seeds-'))
    await mkdir(path.join(dir, 'seeds', 'self_research'), { recursive: true })
    await writeFile(
      path.join(dir, 'seeds', 'self_research', 'big.txt'),
      'x'.repeat(MAX_SEED_PAGE_BYTES + 1),
    )
    const one = {
      caseId: 'c1',
      params: {},
      seedPages: [{ url: 'https://a.example.gov/p', file: 'big.txt' }],
    }

    expect(() => loadSeedPages('self_research', one, dir)).toThrow(
      /a seeded page is one page/,
    )
  })

  // The example has to be a case the agent would run and that would reach
  // its page: the agent's input_schema refuses unknown params, and only a
  // URL hint makes it fetch the seeded URL.
  it('gives the example params the agent accepts, hinting the seeded URL', () => {
    if (agent === undefined) throw new Error('registry lost the agent')
    const [one] = loadBackgroundCases(agent, SEEDED_DIR)
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          '../../../../../runbooks/experiments/race_opponent_collection',
          'manifest.json',
        ),
        'utf8',
      ),
    )

    expect(Object.keys(one?.params ?? {}).sort()).toEqual(
      [...manifest.input_schema.required].sort(),
    )
    expect(JSON.stringify(one?.params)).toContain(one?.seedPages?.[0]?.url)
  })
})
