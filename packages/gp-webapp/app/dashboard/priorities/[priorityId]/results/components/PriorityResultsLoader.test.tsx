import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { PriorityResults } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { PriorityResultsLoader } from './PriorityResultsLoader'

vi.mock('./PriorityResultsView', () => ({
  PriorityResultsView: ({ results }: { results: PriorityResults }) => (
    <div data-testid="results-view">{results.respondents.total}</div>
  ),
}))

const RESULTS: PriorityResults = {
  priorityId: 'p1',
  readStatus: {
    answers: 25,
    needed: 20,
    groupsHeard: 12,
    groupsTotal: 12,
    good: true,
    status: 'representative',
    underrepresented: [],
  },
  sends: [],
  respondents: {
    total: 25,
    byChannel: { text: 25, phoneBanking: 0, doorKnocking: 0 },
    joinedCivicPanel: 6,
  },
  themes: [],
  summarizing: false,
  points: [],
  groups: [],
}

beforeEach(() => {
  testQueryClient.clear()
})

describe('PriorityResultsLoader', () => {
  it('loads the results in the browser and shows them', async () => {
    let asked: string | undefined
    api.mock('GET /v1/priorities/:id/results', ({ params }) => {
      asked = params.id
      return { status: 200, data: RESULTS }
    })

    render(<PriorityResultsLoader priorityId="p1" title="Flooding" />)

    expect(screen.getByText('Loading what we heard…')).toBeInTheDocument()
    expect(await screen.findByTestId('results-view')).toHaveTextContent('25')
    expect(asked).toBe('p1')
  })

  it('says so when the results could not be loaded', async () => {
    api.mock('GET /v1/priorities/:id/results', {
      status: 500,
      data: { message: 'down' },
    })

    render(<PriorityResultsLoader priorityId="p1" title="Flooding" />)

    expect(
      await screen.findByText(
        "We couldn't load what we heard. Refresh the page to try again.",
      ),
    ).toBeInTheDocument()
  })
})
