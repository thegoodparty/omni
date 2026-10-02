import { describe, expect, it } from 'vitest'
import { ChatClarifyQuestionSchema } from './ClarifyQuestion.schema'

const base = {
  questionId: 'q1',
  question: 'Which of these hold up for you?',
  options: [{ label: 'Curbside pilot' }, { label: 'Expand drop-off sites' }],
}

describe('ChatClarifyQuestionSchema', () => {
  it('parses a question persisted before multiSelect existed as single choice', () => {
    expect(ChatClarifyQuestionSchema.parse(base).multiSelect).toBe(false)
  })

  it('keeps multiSelect when the agent sets it', () => {
    expect(
      ChatClarifyQuestionSchema.parse({ ...base, multiSelect: true })
        .multiSelect,
    ).toBe(true)
  })

  it('rejects a non-boolean multiSelect', () => {
    expect(
      ChatClarifyQuestionSchema.safeParse({ ...base, multiSelect: 'yes' })
        .success,
    ).toBe(false)
  })
})
