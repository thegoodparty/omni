import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import OpponentResearchProgress from './OpponentResearchProgress'

// Each step spends STEP_WORKING_MS spinning, then STEP_DONE_MS showing its
// completed checkmark, before advancing — the two sum to one step cadence.
const STEP_WORKING_MS = 3500
const STEP_STEP_MS = 4000

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

  it('shows a spinner (not a checkmark) while a step is in progress', () => {
    const { container } = render(<OpponentResearchProgress />)

    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument()
    expect(container.querySelector('svg.text-success')).not.toBeInTheDocument()
  })

  it('flashes a checkmark when a step completes before advancing', () => {
    vi.useFakeTimers()
    const { container, getByText } = render(<OpponentResearchProgress />)

    // After the working phase but before the next step begins, the current
    // step shows its completed checkmark while the counter still reads 0-of-4.
    act(() => {
      vi.advanceTimersByTime(STEP_WORKING_MS)
    })

    expect(container.querySelector('svg.text-success')).toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).not.toBeInTheDocument()
    expect(getByText('Researching ballot data')).toBeInTheDocument()
    expect(getByText('0 of 4 steps complete')).toBeInTheDocument()
  })

  it('advances the current-step label and counter on the timer', () => {
    vi.useFakeTimers()
    const { getByText } = render(<OpponentResearchProgress />)

    expect(getByText('Researching ballot data')).toBeInTheDocument()
    expect(getByText('0 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_STEP_MS)
    })
    expect(getByText('Identifying candidate website')).toBeInTheDocument()
    expect(getByText('1 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_STEP_MS)
    })
    expect(getByText('Analyzing strengths and weaknesses')).toBeInTheDocument()
    expect(getByText('2 of 4 steps complete')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(STEP_STEP_MS)
    })
    expect(getByText('Compiling actions to take')).toBeInTheDocument()
    expect(getByText('3 of 4 steps complete')).toBeInTheDocument()
  })

  it('holds on the last step rather than claiming ready when the timer runs long', () => {
    vi.useFakeTimers()
    const { container, getByText, queryByText } = render(
      <OpponentResearchProgress />,
    )

    // Advance well past the four steps; without a real `ready` it must hold on
    // step 4 and never reach "4 of 4" / the ready heading on the timer alone.
    act(() => {
      vi.advanceTimersByTime(STEP_STEP_MS * 10)
    })

    expect(getByText('Compiling actions to take')).toBeInTheDocument()
    expect(getByText('3 of 4 steps complete')).toBeInTheDocument()
    expect(queryByText('4 of 4 steps complete')).not.toBeInTheDocument()
    expect(queryByText('Your opponent report is ready')).not.toBeInTheDocument()
    // The last step must keep spinning (never show a completed check) until the
    // real run lands.
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument()
    expect(container.querySelector('svg.text-success')).not.toBeInTheDocument()
  })

  it('shows the terminal ready state with the 4-of-4 counter and a checkmark when ready', () => {
    const { container, getByText } = render(<OpponentResearchProgress ready />)

    expect(getByText('Your opponent report is ready')).toBeInTheDocument()
    expect(
      getByText("We've finished compiling everything. Opening your report…"),
    ).toBeInTheDocument()
    expect(getByText('4 of 4 steps complete')).toBeInTheDocument()
    // The ready branch keeps the final step label and swaps its spinner for a
    // completed checkmark.
    expect(getByText('Compiling actions to take')).toBeInTheDocument()
    expect(container.querySelector('svg.text-success')).toBeInTheDocument()
  })
})
