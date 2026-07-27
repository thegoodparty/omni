import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ReachabilityGrid from './ReachabilityGrid'
import type { ListDetailReachability } from '../shared/contacts-types'

const reachability: ListDetailReachability = {
  sms: 120,
  robocall: 0,
  phoneBanking: 45,
  doorKnocking: 10,
  polls: 120,
}

// ENG-10805: sms/polls fenced (mirroring each other, per gp-api), the other
// three channels unfenced with distinct counts — so a channel rendering the
// wrong fenced-ness or the wrong count fails independently of the others.
const partiallyFencedReachability: ListDetailReachability = {
  sms: 10000,
  robocall: 300,
  phoneBanking: 450,
  doorKnocking: 50,
  polls: 10000,
  fenced: {
    sms: true,
    robocall: false,
    phoneBanking: false,
    doorKnocking: false,
    polls: true,
  },
}

describe('ReachabilityGrid', () => {
  it('renders a number for every channel that has one, including zero', () => {
    render(<ReachabilityGrid reachability={reachability} isError={false} />)

    expect(screen.getAllByText('120')).toHaveLength(2)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('renders the same count for polls as for text', () => {
    render(<ReachabilityGrid reachability={reachability} isError={false} />)

    expect(screen.getAllByText(String(reachability.polls))).toHaveLength(2)
  })

  it('renders every channel as Unavailable when the detail fetch failed, never a stale 0', () => {
    render(<ReachabilityGrid reachability={reachability} isError />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(5)
    expect(screen.queryByText('120')).not.toBeInTheDocument()
  })

  it('renders every channel as Unavailable while reachability is undefined (loading)', () => {
    render(<ReachabilityGrid reachability={undefined} isError={false} />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(5)
  })

  it('renders a fenced channel as "10,000+" while unfenced channels stay exact', () => {
    render(
      <ReachabilityGrid
        reachability={partiallyFencedReachability}
        isError={false}
      />,
    )

    expect(screen.getAllByText('10,000+')).toHaveLength(2)
    expect(screen.queryByText('10,000')).not.toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.getByText('450')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
  })
})
