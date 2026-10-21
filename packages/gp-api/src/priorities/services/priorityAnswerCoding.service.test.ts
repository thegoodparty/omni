import { describe, expect, it } from 'vitest'
import { PriorityAnswerCode } from '@/generated/prisma'
import {
  buildCodingPrompt,
  CODING_SYSTEM_PROMPT,
  parseCoding,
} from './priorityAnswerCoding.service'

const QUESTION = 'Should the city add a stop sign at Oak and 5th?'

describe('buildCodingPrompt', () => {
  it('puts the question and every reply, with its id and kind, in the prompt', () => {
    const prompt = buildCodingPrompt(QUESTION, [
      { ref: '1', kind: 'text_reply', text: 'Yes please, "it is scary"' },
      {
        ref: '2',
        kind: 'conversation_note',
        text: 'He is against it.\nWorried about traffic.',
      },
    ])

    expect(prompt).toContain(`The question: ${QUESTION}`)
    const replies = JSON.parse(prompt.split('as JSON:\n')[1] ?? '')
    expect(replies).toEqual([
      { id: '1', kind: 'text_reply', text: 'Yes please, "it is scary"' },
      {
        id: '2',
        kind: 'conversation_note',
        text: 'He is against it.\nWorried about traffic.',
      },
    ])
  })

  // A note is the canvasser describing the resident, and the classifier has
  // to code the resident, the rule constituentFeedbackExtraction keeps too.
  it('tells the model to code the resident, never the note-taker', () => {
    expect(CODING_SYSTEM_PROMPT).toContain('Code what the RESIDENT said')
    for (const code of Object.values(PriorityAnswerCode)) {
      expect(CODING_SYSTEM_PROMPT).toContain(`"${code}"`)
    }
  })
})

describe('parseCoding', () => {
  it('maps each asked id to its code', () => {
    const codes = parseCoding(
      {
        answers: [
          { id: '1', code: 'yes' },
          { id: '2', code: 'no' },
          { id: '3', code: 'mixed' },
          { id: '4', code: 'not_an_answer' },
        ],
      },
      ['1', '2', '3', '4'],
    )

    expect([...codes]).toEqual([
      ['1', PriorityAnswerCode.yes],
      ['2', PriorityAnswerCode.no],
      ['3', PriorityAnswerCode.mixed],
      ['4', PriorityAnswerCode.not_an_answer],
    ])
  })

  it('reads a code the model cased or padded differently', () => {
    const codes = parseCoding({ answers: [{ id: '1', code: ' YES ' }] }, ['1'])
    expect(codes.get('1')).toBe(PriorityAnswerCode.yes)
  })

  // Left uncoded rather than guessed, so the next pass reads it again.
  it('drops a code outside the vocabulary', () => {
    const codes = parseCoding(
      {
        answers: [
          { id: '1', code: 'maybe' },
          { id: '2', code: 'no' },
        ],
      },
      ['1', '2'],
    )
    expect([...codes]).toEqual([['2', PriorityAnswerCode.no]])
  })

  it('ignores an id it never asked about and keeps the first of a repeat', () => {
    const codes = parseCoding(
      {
        answers: [
          { id: '1', code: 'yes' },
          { id: '1', code: 'no' },
          { id: '9', code: 'no' },
        ],
      },
      ['1', '2'],
    )
    expect([...codes]).toEqual([['1', PriorityAnswerCode.yes]])
  })
})
