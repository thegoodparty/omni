import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import AuthorityFindingWidget from './AuthorityFindingWidget'
import type { OrdinanceAuthorityFinding } from '@goodparty_org/contracts'

const passFinding: OrdinanceAuthorityFinding = {
  status: 'pass',
  headline: 'Pass. The council has authority to act.',
  explanation:
    'Local control of municipal police surveillance policy sits inside the council powers under Or. Rev. Stat. § 181A.250. The proposed amendment regulates city-operated cameras only.',
  confirmation:
    'Green light. Nothing here needs a ballot measure. You can introduce this as an amendment to Chapter 12.',
  source: {
    id: 'or-rs-181a',
    title: 'Or. Rev. Stat. § 181A.250',
    publisher: 'Oregon Revised Statutes',
    url: 'https://www.oregonlegislature.gov/bills_laws/ors/ors181A.html',
    excerpt:
      'Permits municipal police agencies to operate public-space surveillance subject to local policy.',
  },
}

describe('AuthorityFindingWidget', () => {
  it('renders the pass verdict card with every field', () => {
    render(<AuthorityFindingWidget finding={passFinding} />)
    expect(
      screen.getByText('Pass. The council has authority to act.'),
    ).toBeVisible()
    expect(
      screen.getByText(/Local control of municipal police surveillance/),
    ).toBeVisible()
    expect(screen.getByText(/Green light. Nothing here needs/)).toBeVisible()
    expect(screen.getByText('source:')).toBeVisible()
    expect(screen.getByText('Or. Rev. Stat. § 181A.250')).toBeVisible()
    expect(screen.getByLabelText('Authority confirmed')).toBeInTheDocument()
  })

  it('renders the flag verdict as a blocker', () => {
    render(
      <AuthorityFindingWidget
        finding={{
          status: 'flag',
          headline: 'Stop. This needs state action.',
          explanation: 'State law preempts local camera retention rules.',
          source: passFinding.source,
        }}
      />,
    )
    expect(screen.getByText('Stop. This needs state action.')).toBeVisible()
    expect(
      screen.getByText('State law preempts local camera retention rules.'),
    ).toBeVisible()
    expect(screen.getByLabelText('Authority problem')).toBeInTheDocument()
  })

  it('renders the attention verdict as a caveat', () => {
    render(
      <AuthorityFindingWidget
        finding={{
          status: 'attention',
          headline: 'Likely yes, with a caveat.',
          explanation: 'Charter cities need a council supermajority here.',
          source: passFinding.source,
        }}
      />,
    )
    expect(screen.getByText('Likely yes, with a caveat.')).toBeVisible()
    expect(screen.getByLabelText('Authority caveat')).toBeInTheDocument()
  })

  it('omits the confirmation line when the payload has none', () => {
    const { confirmation: _dropped, ...withoutConfirmation } = passFinding
    render(<AuthorityFindingWidget finding={withoutConfirmation} />)
    expect(
      screen.getByText('Pass. The council has authority to act.'),
    ).toBeVisible()
    expect(screen.queryByText(/Green light/)).not.toBeInTheDocument()
  })
})
