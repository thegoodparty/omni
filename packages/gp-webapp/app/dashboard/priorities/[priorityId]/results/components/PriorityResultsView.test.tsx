import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { PriorityResults } from '@goodparty_org/contracts'
import { PriorityResultsView } from './PriorityResultsView'

vi.mock('./RespondentHeatGrid', () => ({
  RespondentHeatGrid: ({ points }: { points: unknown[] }) => (
    <div data-testid="heat-grid">{points.length}</div>
  ),
}))

const results = (
  overrides: Partial<PriorityResults> = {},
): PriorityResults => ({
  priorityId: 'p1',
  sends: [
    {
      outreachId: 4,
      name: 'Oak Street flooding: homeowners',
      channel: 'text',
      date: '2026-10-12T15:00:00.000Z',
      reached: 60,
      responded: 25,
    },
  ],
  respondents: {
    total: 25,
    byChannel: { text: 25, phoneBanking: 0, doorKnocking: 0 },
    joinedCivicPanel: 6,
  },
  themes: [
    {
      id: 't1',
      title: 'Drains back up into homes',
      summary: 'Most said the storm drains overflow in every heavy rain.',
      people: 14,
    },
  ],
  summarizing: false,
  points: [{ lat: 35.595, lng: -82.551 }],
  representation: {
    respondentCount: 25,
    groups: [
      {
        dimension: 'housing',
        key: 'renters',
        label: 'Rent their home',
        respondentShare: 0.2,
        districtShare: 0.4,
      },
      {
        dimension: 'housing',
        key: 'owners',
        label: 'Own their home',
        respondentShare: 0.8,
        districtShare: 0.6,
      },
    ],
  },
  ...overrides,
})

const renderView = (data: PriorityResults) =>
  render(
    <PriorityResultsView priorityId="p1" title="Flooding" results={data} />,
  )

describe('PriorityResultsView', () => {
  it('shows who answered, the panel and the map', () => {
    renderView(results())

    expect(screen.getByText('What we heard on Flooding')).toBeInTheDocument()
    expect(screen.getByText('People who answered')).toBeInTheDocument()
    expect(screen.getByText('Joined your civic panel')).toBeInTheDocument()
    expect(screen.getByText('25 by text')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByTestId('heat-grid')).toHaveTextContent('1')
  })

  it('shows the themes across every send, with how many people each covers', () => {
    renderView(results())

    expect(screen.getByText('Top themes')).toBeInTheDocument()
    expect(screen.getByText('Drains back up into homes')).toBeInTheDocument()
    expect(screen.getByText('14 people')).toBeInTheDocument()
    expect(
      screen.queryByText('Updating with the latest answers.'),
    ).not.toBeInTheDocument()
  })

  it('says when there are no themes yet, and when new answers are being added', () => {
    renderView(results({ themes: [], summarizing: true }))

    expect(
      screen.getByText('Themes show up once at least 5 people have answered.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Updating with the latest answers.'),
    ).toBeInTheDocument()
  })

  it('reads over and under against the district', () => {
    renderView(results())

    expect(screen.getAllByText('20 points under').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20 points over').length).toBeGreaterThan(0)
  })

  it('asks for more answers before comparing with the district', () => {
    renderView(results({ representation: null }))

    expect(
      screen.getByText(
        'Hear from at least 10 people to compare them with your district.',
      ),
    ).toBeInTheDocument()
  })

  it('says when the district census figures are unavailable', () => {
    renderView(results({ representation: { respondentCount: 25, groups: [] } }))

    expect(
      screen.getByText(
        'Census figures for your district are not available yet. Email support@goodparty.org so we can look into it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('More than their share')).not.toBeInTheDocument()
  })
})
