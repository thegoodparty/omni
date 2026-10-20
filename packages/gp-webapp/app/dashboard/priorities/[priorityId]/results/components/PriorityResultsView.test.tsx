import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { PriorityResults } from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PriorityResultsView } from './PriorityResultsView'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('./RespondentHeatGrid', () => ({
  RespondentHeatGrid: ({ points }: { points: unknown[] }) => (
    <div data-testid="heat-grid">{points.length}</div>
  ),
}))

const results = (
  overrides: Partial<PriorityResults> = {},
): PriorityResults => ({
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
  describe('before a good read', () => {
    const early = () =>
      results({
        readStatus: {
          answers: 25,
          needed: 96,
          groupsHeard: 9,
          groupsTotal: 12,
          good: false,
          status: 'tooEarly',
          underrepresented: [],
        },
      })

    it('shows who answered and how many groups have been heard', () => {
      renderView(early())

      expect(screen.getByText('People who answered')).toBeInTheDocument()
      expect(screen.getByText('25 by text')).toBeInTheDocument()
      expect(screen.getByText('9 of 12 groups heard')).toBeInTheDocument()
      expect(
        screen.getByRole('progressbar', { name: '9 of 12 groups heard' }),
      ).toBeInTheDocument()
    })

    it('holds back the themes, the map and the comparison behind one line', () => {
      renderView(early())

      expect(
        screen.getByText(
          "Some groups haven't answered yet. We'll show what we heard once every group has.",
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText('Top themes')).not.toBeInTheDocument()
      expect(
        screen.queryByText('Drains back up into homes'),
      ).not.toBeInTheDocument()
      expect(screen.queryByTestId('heat-grid')).not.toBeInTheDocument()
      expect(
        screen.queryByText("Who you're hearing from"),
      ).not.toBeInTheDocument()
    })

    it('sends Get answers back to the priority to ask the agent', () => {
      renderView(early())

      expect(screen.getByRole('link', { name: 'Get answers' })).toHaveAttribute(
        'href',
        '/dashboard/priorities/p1?getAnswers=1',
      )
    })
  })

  it('names the groups to hear more from while the model is unsure of some', () => {
    renderView(
      results({
        readStatus: {
          answers: 140,
          needed: 96,
          groupsHeard: 12,
          groupsTotal: 12,
          good: false,
          status: 'gettingClose',
          underrepresented: ['unreachedAreas'],
        },
      }),
    )

    expect(
      screen.getByRole('heading', {
        name: 'Still unsure what some groups think',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "We'll show what we heard once we're sure what every group thinks.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('people in a few neighborhoods'),
    ).toBeInTheDocument()
    // Every group heard but the model not sure yet: a full bar in the
    // warning tone, never the success one.
    const bar = screen.getByRole('progressbar', {
      name: '12 of 12 groups heard',
    })
    expect(bar.className).toContain('bg-warning')
    expect(screen.queryByText('Top themes')).not.toBeInTheDocument()
  })

  it('shows everything once there is a good read', () => {
    renderView(results())

    expect(screen.queryByTestId('results-held-back')).not.toBeInTheDocument()
    expect(screen.getByText('Top themes')).toBeInTheDocument()
    expect(screen.getByText("Who you're hearing from")).toBeInTheDocument()
    expect(screen.getByTestId('heat-grid')).toBeInTheDocument()
  })

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

  it('records the view with the read status', () => {
    renderView(results())

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Priorities.ResultsViewed, {
      priorityId: 'p1',
      heldBack: false,
      readStatus: 'every_group_heard',
      answers: 25,
      answersFloor: 20,
      groupsHeard: 12,
      groupsTotal: 12,
      respondentCount: 25,
      joinedCivicPanel: 6,
      representationShown: true,
    })
  })
})
