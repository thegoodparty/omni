import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DrawerHandle } from './drawer'

describe('DrawerHandle', () => {
  const handle = (container: HTMLElement) =>
    container.querySelector('[data-slot="drawer-handle"]')

  it('keeps the 120x8 handle by default so other drawers are unchanged', () => {
    const { container } = render(<DrawerHandle />)

    expect(handle(container)).toHaveClass('h-2', 'w-30')
    expect(handle(container)).not.toHaveClass('w-9')
  })

  it('draws the 36x5 phone handle at size sm', () => {
    const { container } = render(<DrawerHandle size="sm" />)

    expect(handle(container)).toHaveClass('h-[5px]', 'w-9')
    expect(handle(container)).not.toHaveClass('w-30')
  })
})
