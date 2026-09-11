import { describe, expect, it } from 'vitest'
import { parseTurnText, splitSegments } from './stepProtocol'

const question =
  '```priority\n{"ask": "Who does this hit?", "options": ["Renters", "Owners"]}\n```'
const settled = '```priority\n{"settled": "We agreed on renters."}\n```'

describe('parseTurnText', () => {
  it('reads a question and keeps the prose above it', () => {
    const { prose, directive } = parseTurnText(
      `Here is what I found.\n${question}`,
    )
    expect(prose).toBe('Here is what I found.')
    expect(directive).toEqual({
      kind: 'question',
      ask: 'Who does this hit?',
      options: ['Renters', 'Owners'],
      notes: [],
    })
  })

  it('reads a synthesis', () => {
    expect(parseTurnText(settled).directive).toEqual({
      kind: 'synthesis',
      settled: 'We agreed on renters.',
      verify: null,
    })
  })

  it('reads the check the agent proposes alongside a settled step', () => {
    const withVerify =
      '```priority\n{"settled": "Renters on the flood blocks.", "verify": ' +
      '{"who": "Renters on Oak and Third", "ask": "Did the flooding reach ' +
      'your unit this year?"}}\n```'
    expect(parseTurnText(withVerify).directive).toEqual({
      kind: 'synthesis',
      settled: 'Renters on the flood blocks.',
      verify: {
        who: 'Renters on Oak and Third',
        ask: 'Did the flooding reach your unit this year?',
      },
    })
  })

  it('withholds a block that has opened but not closed', () => {
    // Mid-stream: half a JSON object must never reach the screen, and the step
    // must not read as settled until the block is whole.
    const partial = 'Working on it.\n```priority\n{"ask": "Who doe'
    const { prose, directive } = parseTurnText(partial)
    expect(prose).toBe('Working on it.')
    expect(directive).toBeNull()
  })

  it('treats a malformed or off-contract block as no directive', () => {
    expect(parseTurnText('```priority\nnot json\n```').directive).toBeNull()
    // One option is not a choice.
    expect(
      parseTurnText('```priority\n{"ask": "?", "options": ["only"]}\n```')
        .directive,
    ).toBeNull()
  })

  it('leaves an ordinary turn alone', () => {
    const plain = 'Just an answer, no block.'
    expect(parseTurnText(plain)).toEqual({ prose: plain, directive: null })
  })
})

describe('splitSegments', () => {
  it('keeps tool pills and drops only the directive text', () => {
    const { segments, directive } = splitSegments([
      { kind: 'text', text: 'Let me look.' },
      { kind: 'tool', toolName: 'web_search' },
      { kind: 'text', text: `Found it.\n${question}` },
    ])
    expect(segments).toEqual([
      { kind: 'text', text: 'Let me look.' },
      { kind: 'tool', toolName: 'web_search' },
      { kind: 'text', text: 'Found it.' },
    ])
    expect(directive?.kind).toBe('question')
  })

  it('drops a text segment that is nothing but the block', () => {
    const { segments } = splitSegments([
      { kind: 'text', text: 'Prose.' },
      { kind: 'text', text: question },
    ])
    expect(segments).toEqual([{ kind: 'text', text: 'Prose.' }])
  })
})
