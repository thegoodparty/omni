import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import Home from './Home'

vi.mock('./HomeGreeting', () => ({
  default: () => <div>home-greeting</div>,
}))
vi.mock('./NextThingCard', () => ({
  default: () => <div>next-thing-card</div>,
}))
vi.mock('./HomeComposer', () => ({
  default: () => <div>home-composer</div>,
}))

describe('Home', () => {
  it('is a greeting, the next thing and a chat box, nothing else', () => {
    const { container } = render(<Home />)

    expect(screen.getByText('home-greeting')).toBeInTheDocument()
    expect(screen.getByText('next-thing-card')).toBeInTheDocument()
    expect(screen.getByText('home-composer')).toBeInTheDocument()
    expect(container.textContent).toBe(
      'home-greetingnext-thing-cardhome-composer',
    )
  })
})
