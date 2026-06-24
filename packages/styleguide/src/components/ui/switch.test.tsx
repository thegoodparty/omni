import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch, SwitchLabel, SwitchBox } from './switch'

// ---------------------------------------------------------------------------
// Switch (bare)
// ---------------------------------------------------------------------------

describe('Switch', () => {
  it('renders unchecked by default', () => {
    render(<Switch aria-label="Toggle" />)
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('renders checked when defaultChecked is set', () => {
    render(<Switch aria-label="Toggle" defaultChecked />)
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked')
  })

  it('toggles state on click', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="Toggle" />)
    const sw = screen.getByRole('switch')

    expect(sw).toHaveAttribute('data-state', 'unchecked')
    await user.click(sw)
    expect(sw).toHaveAttribute('data-state', 'checked')
    await user.click(sw)
    expect(sw).toHaveAttribute('data-state', 'unchecked')
  })

  it('calls onCheckedChange with next value', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Switch aria-label="Toggle" onCheckedChange={handler} />)

    await user.click(screen.getByRole('switch'))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(true)
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(<Switch aria-label="Toggle" disabled onCheckedChange={handler} />)

    await user.click(screen.getByRole('switch'))
    expect(handler).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('toggles via Space key', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="Toggle" />)

    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked')
  })

  it('respects controlled checked prop', async () => {
    const user = userEvent.setup()
    const handler = vi.fn()
    render(
      <Switch aria-label="Toggle" checked={false} onCheckedChange={handler} />,
    )

    await user.click(screen.getByRole('switch'))
    expect(handler).toHaveBeenCalledWith(true)
    // controlled — state stays false until parent updates
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('forwards className to the root element', () => {
    render(<Switch aria-label="Toggle" className="test-class" />)
    expect(screen.getByRole('switch')).toHaveClass('test-class')
  })
})

// ---------------------------------------------------------------------------
// SwitchLabel
// ---------------------------------------------------------------------------

describe('SwitchLabel', () => {
  it('renders label text', () => {
    render(<SwitchLabel id="sl" label="Notifications" />)
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <SwitchLabel
        id="sl"
        label="Notifications"
        description="Get email alerts."
      />,
    )
    expect(screen.getByText('Get email alerts.')).toBeInTheDocument()
  })

  it('does not render description element when omitted', () => {
    render(<SwitchLabel id="sl" label="Notifications" />)
    expect(document.getElementById('sl-description')).not.toBeInTheDocument()
  })

  it('associates label with switch via htmlFor', () => {
    render(<SwitchLabel id="sl" label="Notifications" />)
    const label = screen.getByText('Notifications')
    expect(label.closest('label')).toHaveAttribute('for', 'sl')
    expect(screen.getByRole('switch')).toHaveAttribute('id', 'sl')
  })

  it('associates description with switch via aria-describedby', () => {
    render(
      <SwitchLabel
        id="sl"
        label="Notifications"
        description="Get email alerts."
      />,
    )
    expect(screen.getByRole('switch')).toHaveAttribute(
      'aria-describedby',
      'sl-description',
    )
    expect(screen.getByText('Get email alerts.')).toHaveAttribute(
      'id',
      'sl-description',
    )
  })

  it('clicking label toggles the switch', async () => {
    const user = userEvent.setup()
    render(<SwitchLabel id="sl" label="Notifications" />)

    await user.click(screen.getByText('Notifications'))
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked')
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    render(<SwitchLabel id="sl" label="Notifications" disabled />)

    await user.click(screen.getByText('Notifications'))
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('forwards switchClassName to the switch element', () => {
    render(
      <SwitchLabel id="sl" label="Notifications" switchClassName="ring-test" />,
    )
    expect(screen.getByRole('switch')).toHaveClass('ring-test')
  })

  it('forwards className to the wrapper element', () => {
    render(
      <SwitchLabel id="sl" label="Notifications" className="wrapper-class" />,
    )
    expect(
      screen.getByRole('switch').closest('[data-slot="switch-label"]'),
    ).toHaveClass('wrapper-class')
  })
})

// ---------------------------------------------------------------------------
// SwitchBox
// ---------------------------------------------------------------------------

describe('SwitchBox', () => {
  it('renders label and description', () => {
    render(<SwitchBox id="sb" label="Dark mode" description="Switch themes." />)
    expect(screen.getByText('Dark mode')).toBeInTheDocument()
    expect(screen.getByText('Switch themes.')).toBeInTheDocument()
  })

  it('wraps content in a card element', () => {
    render(<SwitchBox id="sb" label="Dark mode" />)
    expect(
      screen.getByRole('switch').closest('[data-slot="switch-box"]'),
    ).toBeInTheDocument()
  })

  it('toggles on click', async () => {
    const user = userEvent.setup()
    render(<SwitchBox id="sb" label="Dark mode" />)

    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked')
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    render(<SwitchBox id="sb" label="Dark mode" disabled />)

    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('forwards className to the card wrapper', () => {
    render(<SwitchBox id="sb" label="Dark mode" className="card-class" />)
    expect(
      screen.getByRole('switch').closest('[data-slot="switch-box"]'),
    ).toHaveClass('card-class')
  })

  it('forwards switchClassName to the switch element', () => {
    render(<SwitchBox id="sb" label="Dark mode" switchClassName="ring-test" />)
    expect(screen.getByRole('switch')).toHaveClass('ring-test')
  })
})
