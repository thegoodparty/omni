import { describe, expect, it } from 'vitest'
import { DEPARTURE_NOTE, readTalkingPoints } from './talkingPointsCard'

const close = { text: DEPARTURE_NOTE, bullet: true }

// A row frozen before free text: question, context, call to action, ask.
const LEGACY = [
  'What would you fix around here first?',
  'Fix our roads with a real maintenance plan, not patchwork.',
  'Point them to sarahchen.org to learn more.',
  'Ask whether we can count on them in November.',
].join('\n')

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

  describe('a legacy four-line row', () => {
    // Old walk lists are not migrated, so they read exactly as they always did.
    it('reads the four lines as bullets, then the close', () => {
      expect(readTalkingPoints(LEGACY)).toEqual({
        points: [
          {
            text: 'What would you fix around here first?',
            bullet: true,
          },
          {
            text: 'Fix our roads with a real maintenance plan, not patchwork.',
            bullet: true,
          },
          { text: 'Point them to sarahchen.org to learn more.', bullet: true },
          {
            text: 'Ask whether we can count on them in November.',
            bullet: true,
          },
          close,
        ],
        legacy: true,
      })
    })

    // A campaign with no website on file stored a blank call to action.
    it('drops a blank section', () => {
      expect(readTalkingPoints('Question?\nContext.\n\nAsk.')).toEqual({
        points: [
          { text: 'Question?', bullet: true },
          { text: 'Context.', bullet: true },
          { text: 'Ask.', bullet: true },
          close,
        ],
        legacy: true,
      })
    })
  })

  describe('free text', () => {
    it('reads drafted bullets without their markers', () => {
      const stored = [
        '• Ask what they would fix first.',
        '• Mention the road maintenance plan.',
        '• Invite them to the town hall on Tuesday.',
        '• Ask if we can count on their vote.',
        '• Offer a yard sign.',
      ].join('\n')

      expect(readTalkingPoints(stored)).toEqual({
        points: [
          { text: 'Ask what they would fix first.', bullet: true },
          { text: 'Mention the road maintenance plan.', bullet: true },
          { text: 'Invite them to the town hall on Tuesday.', bullet: true },
          { text: 'Ask if we can count on their vote.', bullet: true },
          { text: 'Offer a yard sign.', bullet: true },
        ],
        legacy: false,
      })
    })

    // A four-line draft is still free text once any line carries a marker.
    it('reads four lines with a marker as free text', () => {
      expect(readTalkingPoints('• One.\nTwo.\nThree.\nFour.')).toEqual({
        points: [
          { text: 'One.', bullet: true },
          { text: 'Two.', bullet: false },
          { text: 'Three.', bullet: false },
          { text: 'Four.', bullet: false },
        ],
        legacy: false,
      })
    })

    it('keeps bullets and sentences in the order written', () => {
      const stored = [
        'I am knocking about the roads.',
        '• Ask what they would fix first.',
        '• Mention the maintenance plan.',
        'Thank them either way.',
        '• Offer a yard sign.',
      ].join('\n')

      expect(readTalkingPoints(stored)).toEqual({
        points: [
          { text: 'I am knocking about the roads.', bullet: false },
          { text: 'Ask what they would fix first.', bullet: true },
          { text: 'Mention the maintenance plan.', bullet: true },
          { text: 'Thank them either way.', bullet: false },
          { text: 'Offer a yard sign.', bullet: true },
        ],
        legacy: false,
      })
    })

    it('reads a paragraph with no bullets as written', () => {
      expect(
        readTalkingPoints(
          'Ask about the roads and listen. Then invite them to the town hall.',
        ),
      ).toEqual({
        points: [
          {
            text: 'Ask about the roads and listen. Then invite them to the town hall.',
            bullet: false,
          },
        ],
        legacy: false,
      })
    })

    it('drops blank lines and trims each line', () => {
      expect(
        readTalkingPoints('\n•   Ask about the roads.  \n\n\n  Then listen.\n'),
      ).toEqual({
        points: [
          { text: 'Ask about the roads.', bullet: true },
          { text: 'Then listen.', bullet: false },
        ],
        legacy: false,
      })
    })

    it('does not count a trailing newline as a line', () => {
      expect(readTalkingPoints('One.\nTwo.\nThree.\n')).toEqual({
        points: [
          { text: 'One.', bullet: false },
          { text: 'Two.', bullet: false },
          { text: 'Three.', bullet: false },
        ],
        legacy: false,
      })
    })

    // The accepted edge: four plain lines cannot be told apart from a legacy
    // row, so they read as bullets inside the composed frame. The words reach
    // the door either way.
    it('reads exactly four plain lines as a legacy row', () => {
      expect(readTalkingPoints('One.\nTwo.\nThree.\nFour.')).toEqual({
        points: [
          { text: 'One.', bullet: true },
          { text: 'Two.', bullet: true },
          { text: 'Three.', bullet: true },
          { text: 'Four.', bullet: true },
          close,
        ],
        legacy: true,
      })
    })
  })
})
