import { describe, expect, it } from 'vitest'
import { MAX_CHAT_HISTORY_MESSAGES } from '@/chats/services/chatStream.service'
import { transcriptOverflowText } from './seedTranscript'

// REFUSED BEFORE THE TURN, not discovered during it. The route replays only
// the most recent MAX_CHAT_HISTORY_MESSAGES rows, so a transcript long enough
// to be pushed out of that window by the turns driven after it would be
// written, paid for, and then never shown to the model — and the record would
// claim a mid-conversation condition the agent was never under.
describe('transcriptOverflowText', () => {
  it('passes a transcript that fits beside the turns it precedes', () => {
    expect(transcriptOverflowText(4, 2)).toBeUndefined()
  })

  it('passes a transcript that exactly fills the window', () => {
    expect(
      transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES - 2, 1),
    ).toBeUndefined()
  })

  // The driven turns are the part that is easy to forget: each one puts a
  // user row AND an assistant reply on the record, so three turns cost six.
  it('counts two rows for every turn the runner will drive', () => {
    expect(transcriptOverflowText(MAX_CHAT_HISTORY_MESSAGES - 2, 2)).toMatch(
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
  })
})
