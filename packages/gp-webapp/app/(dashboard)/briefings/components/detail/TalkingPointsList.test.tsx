import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import TalkingPointsList from './TalkingPointsList'
import type { TalkingPoint } from '@shared/briefings/types'

describe('<TalkingPointsList>', () => {
  it('renders legacy bare-string entries as-is', () => {
    const points: TalkingPoint[] = [
      'Lead with the bond-funded framing.',
      'Ask staff about the sole-bid process.',
      'Confirm the DFR tier before the vote.',
    ]
    render(
      <TalkingPointsList points={points} pathPrefix="items/0/talking_points" />,
    )

    expect(
      screen.getByText('Lead with the bond-funded framing.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/why/i)).not.toBeInTheDocument()
  })

  it('renders {text, why} entries with why as a secondary line', () => {
    const points: TalkingPoint[] = [
      {
        text: 'Ask staff to confirm which DFR tier applies.',
        why: 'Voting on an ambiguous figure creates a record problem later.',
      },
      {
        text: 'Pull the item before the vote if cost questions arise.',
        why: 'The consent agenda passes as a block with no path to revisit it.',
      },
      {
        text: 'Frame this as bond-funded up front.',
        why: 'Pre-empts the cost objection the sentiment data suggests.',
      },
    ]
    render(
      <TalkingPointsList points={points} pathPrefix="items/0/talking_points" />,
    )

    expect(
      screen.getByText('Ask staff to confirm which DFR tier applies.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Voting on an ambiguous figure creates a record problem later.',
      ),
    ).toBeInTheDocument()
  })

  it('returns null for an empty list', () => {
    const { container } = render(
      <TalkingPointsList points={[]} pathPrefix="items/0/talking_points" />,
    )
    expect(container.innerHTML).toBe('')
  })
})
