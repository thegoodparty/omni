import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { GateSurface } from './GateSurface'

const setViewport = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
    writable: true,
  })
}

const renderSurface = (onOpenChange = vi.fn()) =>
  render(
    <GateSurface
      open
      onOpenChange={onOpenChange}
      title="Join Pro to send this campaign"
      footer={<button type="button">Join Pro for $299</button>}
    >
      <p>The pitch</p>
    </GateSurface>,
  )

describe('GateSurface', () => {
  afterEach(() => {
    setViewport(1024)
  })

  it('is a centered dialog on a desktop viewport', async () => {
    setViewport(1280)
    renderSurface()

    expect(
      await screen.findByRole('dialog', {
        name: 'Join Pro to send this campaign',
      }),
    ).toHaveAttribute('data-slot', 'dialog-content')
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    expect(screen.getByText('The pitch')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Join Pro for $299' }),
    ).toBeInTheDocument()
  })

  it('is a bottom drawer with the small handle on a phone', async () => {
    setViewport(390)
    renderSurface()

    expect(
      await screen.findByRole('dialog', {
        name: 'Join Pro to send this campaign',
      }),
    ).toHaveAttribute('data-slot', 'drawer-content')
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
    expect(
      document.querySelector('[data-slot="drawer-handle"]'),
    ).toHaveAttribute('data-size', 'sm')
    expect(screen.getByText('The pitch')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Join Pro for $299' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['desktop', 1280],
    ['phone', 390],
  ])('closes with the X on %s', async (_name, width) => {
    setViewport(width)
    const onOpenChange = vi.fn()
    renderSurface(onOpenChange)

    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
