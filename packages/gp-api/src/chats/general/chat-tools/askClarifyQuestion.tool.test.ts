import { describe, expect, it } from 'vitest'
import { buildAskClarifyQuestionTool } from './askClarifyQuestion.tool'

describe('buildAskClarifyQuestionTool', () => {
  const tool = buildAskClarifyQuestionTool()

  it('tells the agent when to ask for several answers', () => {
    expect(tool.description).toContain(
      'Set multiSelect when more than one answer can be true',
    )
    expect(tool.description).toContain(
      'Leave it off when the answers rule each other out',
    )
  })

  it('takes a multi-select question and defaults to single choice', () => {
    const question = {
      questionId: 'q1',
      question: 'Which of these hold up for you?',
      options: [{ label: 'Curbside pilot' }, { label: 'Drop-off sites' }],
    }
    expect(tool.inputSchema.parse(question).multiSelect).toBe(false)
    expect(
      tool.inputSchema.parse({ ...question, multiSelect: true }).multiSelect,
    ).toBe(true)
  })
})
