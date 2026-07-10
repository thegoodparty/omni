import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { fireEvent, screen } from '@testing-library/react'
import ClarifyQuestionWidget from './ClarifyQuestionWidget'
import type { OrdinanceClarifyQuestion } from '@goodparty_org/contracts'

const question: OrdinanceClarifyQuestion = {
  questionId: 'q1',
  question: 'What hours should the limit cover?',
  options: [
    { label: '10pm to 7am', rationale: 'Matches nearby cities' },
    { label: '11pm to 6am' },
  ],
}

describe('ClarifyQuestionWidget', () => {
  it('answers with the chosen option label', () => {
    const onAnswer = vi.fn()
    render(
      <ClarifyQuestionWidget
        question={question}
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByText('What hours should the limit cover?')).toBeVisible()
    fireEvent.click(screen.getByText('10pm to 7am'))
    expect(onAnswer).toHaveBeenCalledWith('10pm to 7am')
  })

  it('answers with a written-in response', () => {
    const onAnswer = vi.fn()
    render(
      <ClarifyQuestionWidget
        question={question}
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByText('Or write your own...'))
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'Midnight to 5am' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onAnswer).toHaveBeenCalledWith('Midnight to 5am')
  })

  it('does not fire when disabled', () => {
    const onAnswer = vi.fn()
    render(
      <ClarifyQuestionWidget
        question={question}
        disabled
        onAnswer={onAnswer}
      />,
    )
    fireEvent.click(screen.getByText('11pm to 6am'))
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
