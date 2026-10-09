import { describe, expect, it } from 'vitest'
import { readTalkingPoints } from './talkingPointsCard'

describe('readTalkingPoints', () => {
  // Every list created before the points step, and every candidate who left
  // the box blank. The walk falls back to the issue stances for these.
  it('is null for a list with no stored card', () => {
    expect(readTalkingPoints(null)).toBeNull()
    expect(readTalkingPoints(undefined)).toBeNull()
    expect(readTalkingPoints('')).toBeNull()
    expect(readTalkingPoints('  \n\n  \n')).toBeNull()
  })

  it('is null for markers with nothing after them', () => {
    expect(readTalkingPoints('• \n•')).toBeNull()
  })

  // A list frozen before free text is not migrated and is not told apart: its
  // four plain lines read as four sentences, with nothing added around them.
  it('reads a pre-free-text card as its sentences, with no close added', () => {
    expect(
      readTalkingPoints(
        [
          'What would you fix around here first?',
          'Fix our roads with a real maintenance plan, not patchwork.',
          '',
          'Ask whether we can count on them in November.',
        ].join('\n'),
      ),
    ).toEqual([
      { text: 'What would you fix around here first?', bullet: false },
      {
        text: 'Fix our roads with a real maintenance plan, not patchwork.',
        bullet: false,
      },
      {
        text: 'Ask whether we can count on them in November.',
        bullet: false,
      },
    ])
  })

  it('reads drafted bullets without their markers, with no close added', () => {
    const stored = [
      '• Open warm, thank them for the time.',
      '• Ask what they would fix first.',
      '• Close by asking if we can count on their vote.',
    ].join('\n')

    expect(readTalkingPoints(stored)).toEqual([
      { text: 'Open warm, thank them for the time.', bullet: true },
      { text: 'Ask what they would fix first.', bullet: true },
      { text: 'Close by asking if we can count on their vote.', bullet: true },
    ])
  })

  it('keeps bullets and sentences in the order written', () => {
    const stored = [
      'I am knocking about the roads.',
      '• Ask what they would fix first.',
      'Thank them either way.',
      '• Offer a yard sign.',
    ].join('\n')

    expect(readTalkingPoints(stored)).toEqual([
      { text: 'I am knocking about the roads.', bullet: false },
      { text: 'Ask what they would fix first.', bullet: true },
      { text: 'Thank them either way.', bullet: false },
      { text: 'Offer a yard sign.', bullet: true },
    ])
  })

  it('drops blank lines and trims each line', () => {
    expect(
      readTalkingPoints('\n•   Ask about the roads.  \n\n\n  Then listen.\n'),
    ).toEqual([
      { text: 'Ask about the roads.', bullet: true },
      { text: 'Then listen.', bullet: false },
    ])
  })
})
