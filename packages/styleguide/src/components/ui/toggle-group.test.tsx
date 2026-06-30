import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

describe('ToggleGroup', () => {
  it('selects one item at a time in single mode', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="single" defaultValue="left" aria-label="Alignment">
        <ToggleGroupItem value="left">Left</ToggleGroupItem>
        <ToggleGroupItem value="center">Center</ToggleGroupItem>
        <ToggleGroupItem value="right">Right</ToggleGroupItem>
      </ToggleGroup>,
    )

    expect(screen.getByText('Left')).toHaveAttribute('data-state', 'on')
    expect(screen.getByText('Center')).toHaveAttribute('data-state', 'off')

    await user.click(screen.getByText('Center'))

    expect(screen.getByText('Center')).toHaveAttribute('data-state', 'on')
    expect(screen.getByText('Left')).toHaveAttribute('data-state', 'off')
  })

  it('allows multiple selections in multiple mode', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="multiple" aria-label="Filters">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    )

    await user.click(screen.getByText('A'))
    await user.click(screen.getByText('B'))

    expect(screen.getByText('A')).toHaveAttribute('data-state', 'on')
    expect(screen.getByText('B')).toHaveAttribute('data-state', 'on')
  })

  it('does not toggle when the group is disabled', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="single" disabled aria-label="Alignment">
        <ToggleGroupItem value="left">Left</ToggleGroupItem>
        <ToggleGroupItem value="center">Center</ToggleGroupItem>
      </ToggleGroup>,
    )

    expect(screen.getByText('Left')).toBeDisabled()

    await user.click(screen.getByText('Left'))

    expect(screen.getByText('Left')).toHaveAttribute('data-state', 'off')
  })

  it('propagates variant and size to items via context', () => {
    render(
      <ToggleGroup type="single" variant="outline" size="sm" aria-label="Range">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    )

    const item = screen.getByText('A')
    expect(item).toHaveAttribute('data-variant', 'outline')
    expect(item).toHaveAttribute('data-size', 'sm')
  })

  it('marks the root and items with data-slot', () => {
    const { container } = render(
      <ToggleGroup type="single" aria-label="Range">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    )

    expect(
      container.querySelector('[data-slot="toggle-group"]'),
    ).toBeInTheDocument()
    expect(screen.getByText('A')).toHaveAttribute(
      'data-slot',
      'toggle-group-item',
    )
  })
})
