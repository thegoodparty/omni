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

// ENG-10806: one failed people-api aggregate call (landline) nulls only the
// channels it backs — the rest of the reachability block still renders real
// numbers, and the route itself stays a 200.
const degradedReachability: ListDetailReachability = {
  sms: 777,
  robocall: null,
  phoneBanking: null,
  doorKnocking: 111,
  polls: 777,
}

describe('ReachabilityGrid', () => {
  it('renders a number for every channel that has one, including zero', () => {
    render(
      <ReachabilityGrid
        reachability={reachability}
        isLoading={false}
        isError={false}
        isWinContext
      />,
    )

    expect(screen.getAllByText('120')).toHaveLength(2)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('renders the same count for polls as for text', () => {
    render(
      <ReachabilityGrid
        reachability={reachability}
        isLoading={false}
        isError={false}
        isWinContext
      />,
    )

    expect(screen.getAllByText(String(reachability.polls))).toHaveLength(2)
  })

  it('renders every channel as Unavailable when the detail fetch failed, never a stale 0', () => {
    render(
      <ReachabilityGrid
        reachability={reachability}
        isLoading={false}
        isError
        isWinContext
      />,
    )

    expect(screen.getAllByText('Unavailable')).toHaveLength(5)
    expect(screen.queryByText('120')).not.toBeInTheDocument()
  })

  it('renders a neutral placeholder — never Unavailable — while loading', () => {
    render(
      <ReachabilityGrid
        reachability={undefined}
        isLoading
        isError={false}
        isWinContext
      />,
    )

    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(5)
  })

  it('degrades only the channels backed by a failed aggregate to Unavailable', () => {
    render(
      <ReachabilityGrid
        reachability={degradedReachability}
        isLoading={false}
        isError={false}
        isWinContext
      />,
    )

    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getAllByText('777')).toHaveLength(2)
    expect(screen.getByText('111')).toBeInTheDocument()
  })

  // Robocall is campaign-side only: a Serve org has no way to send one, so
  // advertising a reachable-by-robocall count on an elected official's list
  // promised a channel that is not there.
  it('drops the robocall tile in Serve and keeps every other channel', () => {
    render(
      <ReachabilityGrid
        reachability={reachability}
        isLoading={false}
        isError={false}
        isWinContext={false}
      />,
    )

    expect(screen.queryByText('Robocall')).not.toBeInTheDocument()
    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.getByText('Polls')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
  })

  it('renders Robocall in Win', () => {
    render(
      <ReachabilityGrid
        reachability={reachability}
        isLoading={false}
        isError={false}
        isWinContext
      />,
    )

    expect(screen.getByText('Robocall')).toBeInTheDocument()
  })
})
