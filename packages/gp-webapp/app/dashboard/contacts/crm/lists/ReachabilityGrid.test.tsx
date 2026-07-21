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
  email: null,
  metaAds: null,
}

describe('ReachabilityGrid', () => {
  it('renders a number for every channel that has one, including zero', () => {
    render(<ReachabilityGrid reachability={reachability} isError={false} />)

    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('renders "Unavailable" (never 0) for channels whose value is null', () => {
    render(<ReachabilityGrid reachability={reachability} isError={false} />)

    // email and metaAds are always null per the contract — both render
    // Unavailable, not 0.
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  })

  it('renders every channel as Unavailable when the detail fetch failed, never a stale 0', () => {
    render(<ReachabilityGrid reachability={reachability} isError />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(6)
    expect(screen.queryByText('120')).not.toBeInTheDocument()
  })

  it('renders every channel as Unavailable while reachability is undefined (loading)', () => {
    render(<ReachabilityGrid reachability={undefined} isError={false} />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(6)
  })
})
