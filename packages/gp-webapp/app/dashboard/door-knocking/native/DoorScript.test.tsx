import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DoorScript from './DoorScript'

const issues = [{ title: 'Housing', body: 'Fund the shelter on Third.' }]

describe('DoorScript', () => {
  // The sheet is a phone screen and the pills below are what the canvasser is
  // reaching for; the script shouldn't push them off-screen.
  it('starts collapsed and opens on tap', () => {
    render(<DoorScript intro="Hi, I'm Jane Doe." issues={issues} />)

    expect(screen.queryByText('Fund the shelter on Third.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /talking points/i }))

    expect(screen.getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
    expect(screen.getByText('Fund the shelter on Third.')).toBeInTheDocument()
    expect(screen.getByText('Housing')).toBeInTheDocument()
  })

  // An empty card would read as a broken feature. The fix lives in the issues
  // editor, so the card simply isn't there until something has been written.
  it('renders nothing when there is no script', () => {
    render(<DoorScript intro="" issues={[]} />)

    expect(screen.queryByRole('button', { name: /talking points/i })).toBeNull()
  })

  it('still renders with an intro but no issues', () => {
    render(<DoorScript intro="Hi, I'm Jane Doe." issues={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /talking points/i }))

    expect(screen.getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
  })

  it('reports its expanded state for assistive tech', () => {
    render(<DoorScript intro="Hi." issues={issues} />)
    const toggle = screen.getByRole('button', { name: /talking points/i })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
