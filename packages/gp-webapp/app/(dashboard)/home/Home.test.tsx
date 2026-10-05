import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import Home from './Home'

let mockFirstName: string | undefined = 'Sarah'
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: mockFirstName }],
}))
vi.mock('./NextThingCard', () => ({
  default: () => <div>next-thing-card</div>,
}))
vi.mock('./HomeComposer', () => ({
  default: () => <div>home-composer</div>,
}))

describe('Home', () => {
  it('is the next thing and a chat box about it, greeting the candidate', () => {
    render(<Home />)

    expect(screen.getByText("Sarah, here's your next step")).toBeInTheDocument()
    expect(screen.getByText('next-thing-card')).toBeInTheDocument()
    expect(screen.getByText('home-composer')).toBeInTheDocument()
  })

  it('greets without a name when there is none', () => {
    mockFirstName = undefined
    render(<Home />)

    expect(screen.getByText("Here's your next step")).toBeInTheDocument()
    mockFirstName = 'Sarah'
  })
})
