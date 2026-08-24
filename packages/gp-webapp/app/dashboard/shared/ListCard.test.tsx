import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ListCard } from './ListCard'

describe('ListCard', () => {
  // Selecting is a button on the title, not a handler on the card. A clickable
  // container around the row's other controls needs stopPropagation on every
  // one of them, and announces as a button holding several buttons.
  it('makes the title the only thing that selects the row', () => {
    const onSelect = vi.fn()
    const onAction = vi.fn()

    render(
      <ListCard
        title="Elm St & 5th"
        onSelect={onSelect}
        controls={<button type="button" onClick={onAction} aria-label="Hide" />}
        actions={
          <button type="button" onClick={onAction}>
            Details
          </button>
        }
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onAction).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Elm St & 5th' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  // A card with nothing to select is a card, not a button that does nothing:
  // the surfaces reusing this one don't all scope a map from a row.
  it('renders the title as a heading when there is nothing to select', () => {
    render(<ListCard title="Elm St & 5th" />)

    expect(screen.getByRole('heading', { name: 'Elm St & 5th' })).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // Every figure on the card is a numeral beside an icon, so the noun it counts
  // exists only for a screen reader. Getting these confused is the failure the
  // door-knocking rail is most exposed to — doors, people and logged people are
  // three different populations.
  it('names each figure for a screen reader', () => {
    render(
      <ListCard
        title="Elm St & 5th"
        meta={[
          { key: 'doors', icon: null, value: '24', label: 'doors' },
          {
            key: 'logged',
            icon: null,
            value: '8 of 31',
            label: 'people logged',
          },
        ]}
      />,
    )

    expect(screen.getByText('24')).toHaveTextContent('24 doors')
    expect(screen.getByText('8 of 31')).toHaveTextContent(
      '8 of 31 people logged',
    )
  })

  // The expanded slot is where the least frequent and most final action goes,
  // so it must not be reachable on a card nobody has opened.
  it('reveals the expanded actions only while selected', () => {
    const { rerender } = render(
      <ListCard
        title="Elm St & 5th"
        expandedActions={<button type="button">Mark this list done</button>}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Mark this list done' }),
    ).toBeNull()

    rerender(
      <ListCard
        title="Elm St & 5th"
        selected
        expandedActions={<button type="button">Mark this list done</button>}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Mark this list done' }),
    ).toBeVisible()
  })

  // Selection changes the border's colour and never its width. These cards
  // stack in a scrolling rail, so a card that thickened on selection would push
  // every card below it down — on every toggle, under the thumb that toggled it.
  it('keeps the border width constant across selection', () => {
    const { rerender } = render(
      <ListCard title="Elm St & 5th" data-testid="card" />,
    )
    expect(screen.getByTestId('card')).toHaveClass('border-2')

    rerender(<ListCard title="Elm St & 5th" selected data-testid="card" />)
    expect(screen.getByTestId('card')).toHaveClass('border-2')
  })
})
