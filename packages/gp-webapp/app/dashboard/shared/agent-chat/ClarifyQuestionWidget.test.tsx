import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClarifyQuestionWidget, {
  formatClarifyChoices,
  parseClarifyChoices,
} from './ClarifyQuestionWidget'
import type { ChatClarifyQuestion } from '@goodparty_org/contracts'

const question: ChatClarifyQuestion = {
  questionId: 'q1',
  question: 'What hours should the limit cover?',
  options: [
    { label: '10pm to 7am', rationale: 'Matches nearby cities' },
    { label: '11pm to 6am' },
  ],
  multiSelect: false,
}

const multi: ChatClarifyQuestion = {
  questionId: 'q2',
  question: 'Which of these hold up for you?',
  options: [
    {
      label: 'Curbside pilot in select neighborhoods',
      rationale: 'Cheap to try',
    },
    { label: 'Expand drop-off sites' },
    { label: 'Fees, fines, and enforcement' },
  ],
  multiSelect: true,
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

  it('keeps single choice a radio group that answers on the first pick', () => {
    const onAnswer = vi.fn()
    render(
      <ClarifyQuestionWidget
        question={question}
        disabled={false}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByRole('radiogroup')).toBeVisible()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Use th/ })).toBeNull()
  })
})

describe('ClarifyQuestionWidget multiSelect', () => {
  const renderMulti = (props: { answer?: string; disabled?: boolean } = {}) => {
    const onAnswer = vi.fn()
    render(
      <ClarifyQuestionWidget
        question={multi}
        disabled={props.disabled ?? false}
        onAnswer={onAnswer}
        {...(props.answer !== undefined ? { answer: props.answer } : {})}
      />,
    )
    return onAnswer
  }

  it('renders the options as a labelled group of checkboxes', () => {
    renderMulti()
    expect(
      screen.getByRole('group', { name: 'Which of these hold up for you?' }),
    ).toBeVisible()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('keeps the button off until something is checked', () => {
    const onAnswer = renderMulti()
    const submit = screen.getByRole('button', { name: 'Use these' })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('sends the checked labels as one line, in option order', () => {
    const onAnswer = renderMulti()
    fireEvent.click(screen.getByText('Expand drop-off sites'))
    expect(onAnswer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Curbside pilot in select neighborhoods'))
    fireEvent.click(screen.getByRole('button', { name: 'Use these' }))
    expect(onAnswer).toHaveBeenCalledWith(
      'Curbside pilot in select neighborhoods and Expand drop-off sites',
    )
  })

  it('unchecks a second click and names the button for one pick', () => {
    const onAnswer = renderMulti()
    const [first, second] = screen.getAllByRole('checkbox')
    fireEvent.click(first!)
    fireEvent.click(second!)
    fireEvent.click(second!)
    expect(second).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onAnswer).toHaveBeenCalledWith(
      'Curbside pilot in select neighborhoods',
    )
  })

  it('checks from the keyboard', async () => {
    const user = userEvent.setup()
    renderMulti()
    await user.tab()
    const [first] = screen.getAllByRole('checkbox')
    expect(first).toHaveFocus()
    await user.keyboard(' ')
    expect(first).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Use this' })).toBeEnabled()
  })

  it('still takes a written-in answer', () => {
    const onAnswer = renderMulti()
    fireEvent.click(screen.getByText('Or write your own...'))
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'None of these' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onAnswer).toHaveBeenCalledWith('None of these')
  })

  it('reloads an answered set checked and locked', () => {
    renderMulti({
      answer:
        'Curbside pilot in select neighborhoods, Expand drop-off sites, and Fees, fines, and enforcement',
    })
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
    ])
    boxes.forEach((b) => expect(b).toBeDisabled())
    expect(screen.queryByRole('button', { name: /Use th/ })).toBeNull()
  })

  it('reloads a written-in answer as written, nothing checked', () => {
    renderMulti({ answer: 'Something else entirely' })
    expect(screen.getByText('Something else entirely')).toBeVisible()
    screen
      .getAllByRole('checkbox')
      .forEach((b) => expect(b).toHaveAttribute('aria-checked', 'false'))
  })

  it('does not fire when disabled', () => {
    const onAnswer = renderMulti({ disabled: true })
    fireEvent.click(screen.getByText('Expand drop-off sites'))
    expect(screen.getByRole('button', { name: 'Use these' })).toBeDisabled()
    expect(onAnswer).not.toHaveBeenCalled()
  })
})

describe('formatClarifyChoices / parseClarifyChoices', () => {
  const labels = [
    'Curbside pilot',
    'Fees, fines, and enforcement',
    'Do nothing and watch',
    'Expand drop-off sites',
  ]

  it('reads like a sentence', () => {
    expect(formatClarifyChoices(['A'])).toBe('A')
    expect(formatClarifyChoices(['A', 'B'])).toBe('A and B')
    expect(formatClarifyChoices(['A', 'B', 'C'])).toBe('A, B, and C')
  })

  it('round-trips every subset, even labels holding commas and "and"', () => {
    for (let mask = 1; mask < 1 << labels.length; mask++) {
      const picked = labels.flatMap((_, i) => (mask & (1 << i) ? [i] : []))
      const line = formatClarifyChoices(picked.map((i) => labels[i]!))
      expect(parseClarifyChoices(line, labels)).toEqual(picked)
    }
  })

  it('returns null for anything that is not an exact set', () => {
    expect(parseClarifyChoices('Curbside pilot and more', labels)).toBeNull()
    expect(parseClarifyChoices('curbside pilot', labels)).toBeNull()
    expect(
      parseClarifyChoices('Expand drop-off sites and Curbside pilot', labels),
    ).toBeNull()
    expect(parseClarifyChoices('', labels)).toBeNull()
  })
})
