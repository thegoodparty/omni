import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './toggle'

describe('Toggle', () => {
  it('renders off by default', () => {
    render(<Toggle aria-label="Bold" />)
    const toggle = screen.getByRole('button', { name: 'Bold' })
    expect(toggle).toHaveAttribute('data-state', 'off')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders on when defaultPressed is set', () => {
    render(<Toggle aria-label="Bold" defaultPressed />)
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'data-state',
      'on',
    )
  })

  it('toggles state on click', async () => {
    const user = userEvent.setup()
    render(<Toggle aria-label="Bold" />)
    const toggle = screen.getByRole('button', { name: 'Bold' })

    expect(toggle).toHaveAttribute('data-state', 'off')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'on')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'off')
  })

  it('calls onPressedChange with next value', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Toggle aria-label="Bold" onPressedChange={handler} />)

    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(true)
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Toggle aria-label="Bold" disabled onPressedChange={handler} />)

    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(handler).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'data-state',
      'off',
    )
  })

  it('toggles via Space key', async () => {
    const user = userEvent.setup()
    render(<Toggle aria-label="Bold" />)

    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'data-state',
      'on',
    )
  })

  it('respects controlled pressed prop', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(
      <Toggle aria-label="Bold" pressed={false} onPressedChange={handler} />,
    )

    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(handler).toHaveBeenCalledWith(true)
    // controlled — state stays off until the parent updates the prop
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'data-state',
      'off',
    )
  })

  it('applies the outline variant border token', () => {
    render(<Toggle aria-label="Bold" variant="outline" />)
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveClass(
      'border-components-input-border',
    )
  })

  it('applies size classes', () => {
    render(<Toggle aria-label="Bold" size="sm" />)
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveClass('h-8')
  })

  it('forwards className to the root element', () => {
    render(<Toggle aria-label="Bold" className="test-class" />)
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveClass(
      'test-class',
    )
  })
})
