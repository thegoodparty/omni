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
    render(
      <DoorScript
        intro="Hi, I'm Jane Doe."
        issues={issues}
        points={[]}
        isServe={false}
      />,
    )

    const script = within(card())
    expect(script.getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
    expect(
      script.getByText('Housing — Fund the shelter on Third.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // The canvas's caption reads "AI-generated from this voter's profile and your
  // candidate info." It is wrong about both halves for both cards this draws:
  // the stances are the candidate's own out of the issues editor, and the
  // stored card was drafted from the LIST rather than from the resident and
  // then edited by the candidate. Printing it would tell a canvasser the lines
  // in front of them were written about the person opening the door.
  it('makes no claim to have generated the script', () => {
    render(
      <DoorScript
        intro="Hi, I'm Jane Doe."
        issues={issues}
        points={[]}
        isServe={false}
      />,
    )

    expect(screen.queryByText(/AI-generated/i)).toBeNull()
  })

  // Two stances can hang off one top issue, so titles repeat and can't key the
  // list — both bodies still have to reach the door.
  it('renders both stances that share a heading', () => {
    render(
      <DoorScript
        intro=""
        isServe={false}
        points={[]}
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
    render(<DoorScript intro="" issues={[]} points={[]} isServe={false} />)

    expect(screen.queryByRole('heading', { name: 'Talking points' })).toBeNull()
  })

  it('still renders with an intro but no issues', () => {
    render(
      <DoorScript
        intro="Hi, I'm Jane Doe."
        issues={[]}
        points={[]}
        isServe={false}
      />,
    )

    expect(within(card()).getByText("Hi, I'm Jane Doe.")).toBeInTheDocument()
  })

  // Serve's card is permanently the opener alone — there is no issues editor
  // behind it to fill — so "Talking points" would head a card that can never
  // hold one. A Win candidate who has written no issues yet keeps the Win
  // heading, because for them the list is empty rather than absent.
  it('heads the serve card for what it actually holds', () => {
    render(
      <DoorScript
        intro="Hi, I'm Jane Doe, your City Council Member."
        issues={[]}
        points={[]}
        isServe
      />,
    )

    const heading = screen.getByRole('heading', { name: 'Introduction' })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Talking points' })).toBeNull()
    expect(
      within(heading.parentElement!).getByText(
        "Hi, I'm Jane Doe, your City Council Member.",
      ),
    ).toBeInTheDocument()
  })

  // The five-section card frozen with the list: the composed opener as the
  // paragraph it has always been, then the stored lines and the close as
  // bullets.
  describe('with a stored card', () => {
    const points = [
      'What would you fix around here first?',
      'Fix our roads with a real maintenance plan.',
      'Ask whether we can count on them in November.',
      'Thank them for their time.',
    ]

    it('reads the opener as a sentence and the sections as bullets', () => {
      render(
        <DoorScript
          intro="Hi, I'm Jane Doe, running for City Council."
          issues={[]}
          points={points}
          isServe={false}
        />,
      )
      const script = within(card())

      expect(
        script.getByText("Hi, I'm Jane Doe, running for City Council."),
      ).toBeInTheDocument()
      points.forEach((point) =>
        expect(script.getByText(point)).toBeInTheDocument(),
      )
    })

    // Two sections can legitimately read alike — a purpose whose ask and whose
    // engagement question circle the same event — and both have to reach the
    // door.
    it('renders two sections that read alike', () => {
      render(
        <DoorScript
          intro=""
          issues={[]}
          points={['Ask them to the town hall.', 'Ask them to the town hall.']}
          isServe={false}
        />,
      )

      expect(
        within(card()).getAllByText('Ask them to the town hall.'),
      ).toHaveLength(2)
    })

    // The one thing that changes about an official's card is that it now has
    // something in it. "Introduction" named a card that could only ever be the
    // opener; this one is talking points by any reading.
    it('heads the serve card for what it now holds', () => {
      render(
        <DoorScript
          intro="Hi, I'm Jane Doe, your City Council Member."
          issues={[]}
          points={points}
          isServe
        />,
      )

      expect(
        screen.getByRole('heading', { name: 'Talking points' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Introduction' })).toBeNull()
    })
  })
})
