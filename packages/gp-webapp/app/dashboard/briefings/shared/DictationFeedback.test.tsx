import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UseDictationAppendResult } from 'app/dashboard/shared/dictation/useDictationAppend'
import { DictationFeedback } from './DictationFeedback'

function makeDictation(
  overrides: Partial<UseDictationAppendResult> = {},
): UseDictationAppendResult {
  return {
    status: 'idle',
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    toggle: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('<DictationFeedback>', () => {
  it('renders the partial transcript with aria-live=polite', () => {
    render(
      <DictationFeedback
        dictation={makeDictation({ partialTranscript: 'hi there' })}
      />,
    )
    const partial = screen.getByText('hi there')
    expect(partial.getAttribute('aria-live')).toBe('polite')
  })

  it('renders the error with role=alert', () => {
    render(
      <DictationFeedback dictation={makeDictation({ error: 'mic blocked' })} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('mic blocked')
  })

  it('uses text-sm sizing on the error (matches saveError styling)', () => {
    render(
      <DictationFeedback dictation={makeDictation({ error: 'mic blocked' })} />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toMatch(/text-sm/)
  })

  it('renders nothing when there is no partial transcript and no error', () => {
    const { container } = render(
      <DictationFeedback dictation={makeDictation()} />,
    )
    expect(container.textContent).toBe('')
  })
})
