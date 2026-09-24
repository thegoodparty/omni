import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { ListDetailsFooter } from './ListDetailsFooter'

// The shared footer had no test of its own until `none` stopped meaning
// "render nothing unconditionally". What is pinned here is the narrow part of
// that change: `none` still renders nothing on its own, and now carries a
// secondary when one is handed to it, because Draft, In review and Denied
// need the shelf and have no canvas position to hang a primary off.
describe('ListDetailsFooter', () => {
  it('renders nothing for a none-mode caller that offers nothing', () => {
    const { container } = render(<ListDetailsFooter mode="none" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders a secondary handed to a none-mode caller', () => {
    render(
      <ListDetailsFooter
        mode="none"
        secondary={<button type="button">Move to archive</button>}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Move to archive' }),
    ).toBeInTheDocument()
  })

  // The reason `none` exists: no canvas CTA for a state the design has no
  // position for. Widening it to carry the shelf must not widen it to this.
  it('still offers no primary action in none mode', () => {
    render(
      <ListDetailsFooter
        mode="none"
        secondary={<button type="button">Move to archive</button>}
        primary={{
          kind: 'button',
          label: 'Continue knocking',
          onClick: vi.fn(),
        }}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Continue knocking' }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing for a done-mode caller that offers nothing', () => {
    const { container } = render(<ListDetailsFooter mode="done" />)

    expect(container).toBeEmptyDOMElement()
  })
})
