import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { DoorKnockingResults } from './DoorKnockingResults'

const results = {
  doorsKnocked: 40,
  byOutcome: {
    answered: 12,
    not_home: 25,
    refused_to_engage: 2,
    inaccessible: 1,
    not_a_voter: 0,
  },
  bySupport: { supporter: 6, unsure: 3, non_supporter: 3 },
  byWillVote: { yes: 8, no: 2, unsure: 1, already_voted: 1 },
  byFollowUp: { yes: 4, no: 8 },
}

describe('DoorKnockingResults', () => {
  it('counts every outcome and answer by door, over doors knocked', async () => {
    api.mock('GET /v1/door-knocking/campaigns/:anchorId/results', {
      status: 200,
      data: results,
    })

    render(<DoorKnockingResults anchorOutreachId={7} isServe={false} />)

    expect(
      await screen.findByText('Based on 40 doors knocked'),
    ).toBeInTheDocument()
    expect(screen.getByText('Not home')).toBeInTheDocument()
    // 25 of 40 doors knocked.
    expect(screen.getByText('63%')).toBeInTheDocument()
    expect(screen.getByText('Support: Yes')).toBeInTheDocument()
    expect(screen.getByText('Will vote: Yes')).toBeInTheDocument()
    expect(screen.queryByText(/Needs follow-up/)).not.toBeInTheDocument()
  })

  it('asks Serve its own questions in its own words', async () => {
    api.mock('GET /v1/door-knocking/campaigns/:anchorId/results', {
      status: 200,
      data: results,
    })

    render(<DoorKnockingResults anchorOutreachId={7} isServe />)

    expect(await screen.findByText('Needs follow-up: Yes')).toBeInTheDocument()
    expect(screen.getByText('Not a constituent')).toBeInTheDocument()
    expect(screen.queryByText(/Support/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Will vote/)).not.toBeInTheDocument()
  })

  it('stays out of the drawer until a door is knocked', async () => {
    api.mock('GET /v1/door-knocking/campaigns/:anchorId/results', {
      status: 200,
      data: { ...results, doorsKnocked: 0 },
    })

    const { container } = render(
      <DoorKnockingResults anchorOutreachId={7} isServe={false} />,
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
