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

  it('reads a synthesis on its own', () => {
    expect(parseTurnText(settled).directive).toEqual({
      kind: 'synthesis',
      settled: 'We agreed on renters.',
    })
  })

  it('reads the outreach as its own turn', () => {
    const turn =
      '```priority\n{"outreach": {"who": "Renters on Oak and Third", ' +
      '"count": 260, "channel": "phone_banking", "why": "They answer a ' +
      'call", "message": "Did the flooding reach your unit?", "listId": 42, ' +
      '"listName": "Flood blocks renters", "campaignName": "Flooding: what ' +
      'renters say"}}\n```'
    expect(parseTurnText(turn).directive).toEqual({
      kind: 'outreach',
      outreach: {
        who: 'Renters on Oak and Third',
        count: 260,
        channel: 'phone_banking',
        why: 'They answer a call',
        message: 'Did the flooding reach your unit?',
        listId: 42,
        listName: 'Flood blocks renters',
        campaignName: 'Flooding: what renters say',
      },
    })
  })

  it('still reads an outreach whose list could not be built', () => {
    const turn =
      '```priority\n{"outreach": {"who": "Renters", "channel": "social", ' +
      '"why": "Reach", "message": "Tell me"}}\n```'
    expect(parseTurnText(turn).directive).toMatchObject({
      kind: 'outreach',
      outreach: { listId: null, listName: null, count: null },
    })
  })

  it('refuses a channel this flow cannot open', () => {
    const turn =
      '```priority\n{"outreach": {"who": "w", "channel": "carrier_pigeon", ' +
      '"why": "y", "message": "m"}}\n```'
    expect(parseTurnText(turn).directive).toBeNull()
  })

  it('reads the organizations as their own turn, with what to say', () => {
    const turn =
      '```priority\n{"orgs": [{"name": "Oak Street Tenants Union", "why": ' +
      '"Reaches renters not in the file", "askFor": "their organizer", ' +
      '"script": "Can you put this to your members?", "email": ' +
      '"hi@oakstreet.org"}]}\n```'
    expect(parseTurnText(turn).directive).toEqual({
      kind: 'orgs',
      orgs: [
        {
          name: 'Oak Street Tenants Union',
          why: 'Reaches renters not in the file',
          askFor: 'their organizer',
          script: 'Can you put this to your members?',
          email: 'hi@oakstreet.org',
          phone: null,
          url: null,
        },
      ],
    })
  })

  it('refuses an organization with no one to ask for and nothing to say', () => {
    // Without those two it is a name on a card, which is the version of this
    // the split was meant to replace.
    const turn =
      '```priority\n{"orgs": [{"name": "Some Group", "why": "reach"}]}\n```'
    expect(parseTurnText(turn).directive).toBeNull()
  })

  it('reads a step parked on the real world', () => {
    const waiting =
      '```priority\n{"waiting": {"on": "the engineer estimate", "unblocks": ' +
      '"costing the culvert option", "when": "after the March 11 meeting"}}' +
      '\n```'
    expect(parseTurnText(waiting).directive).toEqual({
      kind: 'waiting',
      waiting: {
        on: 'the engineer estimate',
        unblocks: 'costing the culvert option',
        when: 'after the March 11 meeting',
      },
    })
  })

  it('flags a complete block it could not read, rather than swallowing it', () => {
    // The turn's prose points at a card ("the groups below"), so a directive
    // that fails validation has to be visible to the caller.
    const bad = '```priority\n{"orgs": [{"name": "Some Group"}]}\n```'
    const parsed = parseTurnText(bad)
    expect(parsed.directive).toBeNull()
    expect(parsed.malformed).toBe(true)
  })

  it('does not call a half-streamed block malformed', () => {
    const partial = 'Working.\n```priority\n{"orgs": [{"na'
    expect(parseTurnText(partial).malformed).toBe(false)
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
    expect(parseTurnText(plain)).toEqual({
      prose: plain,
      directive: null,
      malformed: false,
    })
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
