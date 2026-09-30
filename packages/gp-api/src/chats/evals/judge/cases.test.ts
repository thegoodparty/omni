import { describe, expect, it } from 'vitest'
import { AGENTS } from './agents'
import {
  CaseListError,
  caseListPath,
  loadCaseList,
  parseCaseList,
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
