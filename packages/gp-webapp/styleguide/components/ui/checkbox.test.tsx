import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox, CheckboxLabel } from './checkbox'

// ---------------------------------------------------------------------------
// Checkbox (bare)
// ---------------------------------------------------------------------------

describe('Checkbox', () => {
  it('renders unchecked by default', () => {
    render(<Checkbox aria-label="Agree" />)
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('renders checked when defaultChecked is set', () => {
    render(<Checkbox aria-label="Agree" defaultChecked />)
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })

  it('toggles state on click', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Agree" />)
    const cb = screen.getByRole('checkbox')

    expect(cb).toHaveAttribute('data-state', 'unchecked')
    await user.click(cb)
    expect(cb).toHaveAttribute('data-state', 'checked')
    await user.click(cb)
    expect(cb).toHaveAttribute('data-state', 'unchecked')
  })

  it('calls onCheckedChange with next value', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Checkbox aria-label="Agree" onCheckedChange={handler} />)

    await user.click(screen.getByRole('checkbox'))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(true)
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Checkbox aria-label="Agree" disabled onCheckedChange={handler} />)

    await user.click(screen.getByRole('checkbox'))
    expect(handler).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('toggles via Space key', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Agree" />)

    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })

  it('respects controlled checked prop', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(
      <Checkbox aria-label="Agree" checked={false} onCheckedChange={handler} />,
    )

    await user.click(screen.getByRole('checkbox'))
    expect(handler).toHaveBeenCalledWith(true)
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('forwards className to the root element', () => {
    render(<Checkbox aria-label="Agree" className="test-class" />)
    expect(screen.getByRole('checkbox')).toHaveClass('test-class')
  })
})

// ---------------------------------------------------------------------------
// CheckboxLabel
// ---------------------------------------------------------------------------

describe('CheckboxLabel', () => {
  it('renders label text', () => {
    render(<CheckboxLabel id="cl" label="Accept terms" />)
    expect(screen.getByText('Accept terms')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <CheckboxLabel
        id="cl"
        label="Accept terms"
        description="You agree to our Terms."
      />,
    )
    expect(screen.getByText('You agree to our Terms.')).toBeInTheDocument()
  })

  it('does not render description element when omitted', () => {
    render(<CheckboxLabel id="cl" label="Accept terms" />)
    expect(document.getElementById('cl-description')).not.toBeInTheDocument()
  })

  it('associates label with checkbox via htmlFor', () => {
    render(<CheckboxLabel id="cl" label="Accept terms" />)
    const label = screen.getByText('Accept terms')
    expect(label.closest('label')).toHaveAttribute('for', 'cl')
    expect(screen.getByRole('checkbox')).toHaveAttribute('id', 'cl')
  })

  it('associates description with checkbox via aria-describedby', () => {
    render(
      <CheckboxLabel
        id="cl"
        label="Accept terms"
        description="You agree to our Terms."
      />,
    )
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'aria-describedby',
      'cl-description',
    )
    expect(screen.getByText('You agree to our Terms.')).toHaveAttribute(
      'id',
      'cl-description',
    )
  })

  it('clicking label toggles the checkbox', async () => {
    const user = userEvent.setup()
    render(<CheckboxLabel id="cl" label="Accept terms" />)

    await user.click(screen.getByText('Accept terms'))
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    render(<CheckboxLabel id="cl" label="Accept terms" disabled />)

    await user.click(screen.getByText('Accept terms'))
    expect(screen.getByRole('checkbox')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('forwards checkboxClassName to the checkbox element', () => {
    render(
      <CheckboxLabel
        id="cl"
        label="Accept terms"
        checkboxClassName="ring-test"
      />,
    )
    expect(screen.getByRole('checkbox')).toHaveClass('ring-test')
  })

  it('forwards className to the wrapper element', () => {
    render(
      <CheckboxLabel id="cl" label="Accept terms" className="wrapper-class" />,
    )
    expect(
      screen.getByRole('checkbox').closest('[data-slot="checkbox-label"]'),
    ).toHaveClass('wrapper-class')
  })
})
