import { describe, expect, it } from 'vitest'
import { MAX_CHAT_HISTORY_MESSAGES } from '@/chats/services/chatStream.service'
import { MAX_CASE_TURNS, MAX_SEEDED_TURNS } from '../cases'
import { segmentsFor, transcriptOverflowText } from './seedTranscript'

// REFUSED BEFORE THE TURN, not discovered during it. The route replays only
// the most recent MAX_CHAT_HISTORY_MESSAGES rows, so a transcript long enough
// to be pushed out of that window by the turns driven after it would be
// written, paid for, and then never shown to the model — and the record would
// claim a mid-conversation condition the agent was never under.
describe('transcriptOverflowText', () => {
  it('passes a transcript that fits beside the turns it precedes', () => {
    expect(transcriptOverflowText(4, 2)).toBeUndefined()
  })

  // Three terms, spelled out: the seeded rows, two per driven turn, and one
  // for the scripted opener campaign_assistant's handler seeds itself.
  it('passes a transcript that exactly fills the window', () => {
    expect(
      transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES - 3, 1),
    ).toBeUndefined()
  })

  it('refuses the same transcript one row longer', () => {
    expect(transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES - 2, 1)).toMatch(
      /would be written and then never reach the model/,
    )
  })

  // The driven turns are the part that is easy to forget: each one puts a
  // user row AND an assistant reply on the record, so three turns cost six.
  it('counts two rows for every turn the runner will drive', () => {
    expect(transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES - 4, 2)).toMatch(
      /would be written and then never reach the model/,
    )
  })

  it('refuses a transcript longer than the window on its own', () => {
    expect(transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES + 1, 0)).toContain(
      'replays only the most recent',
    )
  })

  it('says how many rows it counted, so the fix is arithmetic', () => {
    const reason = transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES, 3)
    expect(reason).toContain(`${MAX_CHAT_HISTORY_MESSAGES} row(s)`)
    expect(reason).toContain('3 driven turn(s)')
    expect(reason).toContain(`is ${MAX_CHAT_HISTORY_MESSAGES + 7} rows`)
  })
})

// THE TWO GUARDS HAVE TO AGREE. If a case list can author a transcript the
// runner then refuses, the refusal arrives after a sweep was planned and
// priced — so the authoring bounds are what keep the runner's check a
// backstop rather than the only line.
describe('the authoring bounds against the replay window', () => {
  it('cannot author a transcript the runner would refuse', () => {
    expect(
      transcriptOverflowText(MAX_SEEDED_TURNS, MAX_CASE_TURNS),
    ).toBeUndefined()
  })

  // Headroom, not an exact fit: campaign_assistant's handler seeds a scripted
  // opener before any of this runs, and the arithmetic counts it.
  it('leaves room for the opener a scope seeds itself', () => {
    expect(
      transcriptOverflowText(MAX_SEEDED_TURNS + 1, MAX_CASE_TURNS),
    ).toBeUndefined()
  })
})

// The segments a seeded assistant turn carries, which are the ones a streamed
// turn builds for the same shape.
describe('segmentsFor', () => {
  const withCall = {
    role: 'assistant' as const,
    content: 'Done.',
    toolCalls: [{ tool: 'crud_priorities', input: { action: 'list' } }],
  }

  // `toolCallId` is what a chat card's outreach id is derived from, so two
  // seeded turns each carrying one call must not both be `judge-seeded-0`.
  it('gives every call of every turn its own id', () => {
    const ids = [segmentsFor(withCall, 1), segmentsFor(withCall, 3)]
      .flat()
      .flatMap((segment) => segment.toolCallId ?? [])

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps two calls within one turn apart as well', () => {
    const ids = segmentsFor(
      {
        ...withCall,
        toolCalls: [...withCall.toolCalls, ...withCall.toolCalls],
      },
      0,
    ).flatMap((segment) => segment.toolCallId ?? [])

    expect(new Set(ids).size).toBe(2)
  })

  // Tool calls first and the text after, which is the order a real turn
  // produces for the ordinary tool-then-answer shape.
  it('puts the call before the text it explains', () => {
    expect(segmentsFor(withCall, 0).map((s) => s.kind)).toEqual([
      'tool',
      'text',
    ])
  })

  // A widget-only turn is a real shape: tool calls, no text.
  it('writes no text segment for a turn with no content', () => {
    expect(segmentsFor({ ...withCall, content: '' }, 0)).toHaveLength(1)
  })
})
