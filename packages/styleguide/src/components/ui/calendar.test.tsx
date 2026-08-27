import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Calendar } from './calendar'

// A calendar is nearly always rendered by a parent that re-renders on its own
// schedule (a form, a popover host, a polling flow). If Calendar hands
// DayPicker fresh component identities each time, React tears the day grid
// down and rebuilds it, dropping the click a user is in the middle of making.
// Both tests below fail if the component overrides move back inline.
const Host = ({
  onRerender,
  onSelect,
}: {
  onRerender: (rerender: () => void) => void
  onSelect?: () => void
}) => {
  const [, setTick] = React.useState(0)
  onRerender(() => setTick((tick) => tick + 1))
  return <Calendar mode="single" onSelect={onSelect} />
}

const anyDay = () => screen.getAllByRole('button', { name: /, 20\d\d$/ })[0]!

describe('Calendar', () => {
  it('keeps its day buttons mounted across a parent re-render', () => {
    let rerender!: () => void
    render(<Host onRerender={(fn) => (rerender = fn)} />)

    const day = anyDay()
    act(() => rerender())

    expect(day.isConnected).toBe(true)
  })

  it('still selects a day the parent re-rendered underneath', async () => {
    let rerender!: () => void
    const onSelect = vi.fn()
    render(<Host onRerender={(fn) => (rerender = fn)} onSelect={onSelect} />)

    const day = anyDay()
    act(() => rerender())
    await userEvent.click(day)

    expect(onSelect).toHaveBeenCalled()
  })
})
