import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import OpponentResearchProgress from './OpponentResearchProgress'

const STEP_INTERVAL_MS = 4000

afterEach(() => {
  vi.useRealTimers()
})

describe('<OpponentResearchProgress>', () => {
  it('renders the running heading, the first current-step label, and the 0-of-4 counter', () => {
    const { getByText } = render(<OpponentResearchProgress />)

    expect(getByText('Researching your opponents')).toBeInTheDocument()
    expect(
      getByText(
        "This usually takes under a minute. We'll keep working in the background.",
      ),
    ).toBeInTheDocument()
    expect(getByText('Researching ballot data')).toBeInTheDocument()
    expect(getByText('0 of 4 steps complete')).toBeInTheDocument()
  })

  it('advances the current-step label and counter on the timer', () => {
    vi.useFakeTimers()
    const { getByText } = render(<OpponentResearchProgress />)

    expect(getByText('Researching ballot data')).toBeInTheDocument()
    expect(getByText('0 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS)
    })
    expect(getByText('Identifying candidate website')).toBeInTheDocument()
    expect(getByText('1 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS)
    })
    expect(getByText('Analyzing strengths and weaknesses')).toBeInTheDocument()
    expect(getByText('2 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS)
    })
    expect(getByText('Compiling actions to take')).toBeInTheDocument()
    expect(getByText('3 of 4 steps complete')).toBeInTheDocument()
  })

  it('holds on the last step rather than claiming ready when the timer runs long', () => {
    vi.useFakeTimers()
    const { getByText, queryByText } = render(<OpponentResearchProgress />)

    // Advance well past the four steps; without a real `ready` it must hold on
    // step 4 and never reach "4 of 4" / the ready heading on the timer alone.
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * 10)
    })

    expect(getByText('Compiling actions to take')).toBeInTheDocument()
    expect(getByText('3 of 4 steps complete')).toBeInTheDocument()
    expect(queryByText('4 of 4 steps complete')).not.toBeInTheDocument()
    expect(queryByText('Your opponent report is ready')).not.toBeInTheDocument()
  })

  it('shows the terminal ready state with the 4-of-4 counter when ready', () => {
    const { getByText } = render(<OpponentResearchProgress ready />)

    expect(getByText('Your opponent report is ready')).toBeInTheDocument()
    expect(
      getByText("We've finished compiling everything. Opening your report…"),
    ).toBeInTheDocument()
    expect(getByText('4 of 4 steps complete')).toBeInTheDocument()
    // The current-step row shows the wrap-up label in the ready branch (not an
    // advancing step label), so the ready branch's row copy is covered too.
    expect(getByText('Wrapping up')).toBeInTheDocument()
  })
})
