import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Progress } from './progress'

const indicator = (container: HTMLElement) =>
  container.querySelector('[data-slot="progress-indicator"]')

describe('Progress', () => {
  it('hides the fill at 0%, so no hairline reads as progress', () => {
    const { container } = render(<Progress value={0} />)
    expect(indicator(container)).toHaveClass('opacity-0')
  })

  it('shows the fill once there is progress', () => {
    const { container } = render(<Progress value={30} />)
    expect(indicator(container)).not.toHaveClass('opacity-0')
  })
})
