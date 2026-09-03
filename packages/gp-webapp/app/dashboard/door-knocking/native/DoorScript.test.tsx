import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DoorScript from './DoorScript'

const issues = [{ title: 'Housing', body: 'Fund the shelter on Third.' }]

const card = () =>
  screen.getByRole('heading', { name: 'Talking points' }).parentElement!

describe('DoorScript', () => {
  // `panelCard('Talking points','message-square', …)`: a card in the panel body
  // with its section header, not a disclosure. It used to open on a tap, which
  // is a tap nobody spends while someone is standing in a doorway waiting.
  it('is an open card headed the way the canvas heads it', () => {
    render(<DoorScript intro="Hi, I'm Jane Doe." issues={issues} />)

    const script = within(card())
    expect(script.getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
    expect(
      script.getByText('Housing — Fund the shelter on Third.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // The canvas's caption reads "AI-generated from this voter's profile and your
  // candidate info." Nothing generates these lines — they are the candidate's
  // own stances out of the issues editor — so the sentence would describe the
  // feature as something it isn't, on the one surface read out loud.
  it('makes no claim to have generated the script', () => {
    render(<DoorScript intro="Hi, I'm Jane Doe." issues={issues} />)

    expect(screen.queryByText(/AI-generated/i)).toBeNull()
  })

  // Two stances can hang off one top issue, so titles repeat and can't key the
  // list — both bodies still have to reach the door.
  it('renders both stances that share a heading', () => {
    render(
      <DoorScript
        intro=""
        issues={[
          { title: 'Housing', body: 'Fund the shelter on Third.' },
          { title: 'Housing', body: 'Upzone the transit corridor.' },
        ]}
      />,
    )
    const script = within(card())

    expect(
      script.getByText('Housing — Fund the shelter on Third.'),
    ).toBeInTheDocument()
    expect(
      script.getByText('Housing — Upzone the transit corridor.'),
    ).toBeInTheDocument()
  })

  // An empty card would read as a broken feature. The fix lives in the issues
  // editor, so the card simply isn't there until something has been written.
  it('renders nothing when there is no script', () => {
    render(<DoorScript intro="" issues={[]} />)

    expect(screen.queryByRole('heading', { name: 'Talking points' })).toBeNull()
  })

  it('still renders with an intro but no issues', () => {
    render(<DoorScript intro="Hi, I'm Jane Doe." issues={[]} />)

    expect(within(card()).getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
  })
})
