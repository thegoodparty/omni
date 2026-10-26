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
  groups: [
    { group: 'age65plus', districtShare: 0.2, answerShare: 0.1 },
    { group: 'women', districtShare: 0.5, answerShare: 0.5 },
    { group: 'men', districtShare: 0.5, answerShare: 0.5 },
  ],
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
          representativeAnswers: 18,
          representativeNeeded: 96,
          good: false,
          status: 'tooEarly',
          underrepresented: ['men', 'age65plus'],
          groupsNext: 2,
          unheard: ['men'],
          checkOut: true,
        },
      })

    it('shows who answered and the answers that count as seats', () => {
      renderView(early())

      expect(screen.getByText('People who answered')).toBeInTheDocument()
      expect(screen.getByText('25 by text')).toBeInTheDocument()
      // 25 answered, but only 18 count toward a balanced read.
      expect(
        screen.getByText('18 of the 96 answers we need.'),
      ).toBeInTheDocument()
      expect(screen.queryByText(/groups heard/)).not.toBeInTheDocument()
      const arc = screen.getByRole('img', {
        name: '18 of the 96 answers we need',
      })
      expect(arc.querySelectorAll('[data-state="heard"]')).toHaveLength(19)
      expect(arc.querySelectorAll('[data-state="needed"]')).toHaveLength(81)
      expect(screen.getByText('Still needed')).toBeInTheDocument()
    })

    // jsdom applies no CSS, so this pins the classes that pick one by width.
    it('shows the seats from lg up and the bar below it', () => {
      renderView(early())

      const arc = screen.getByRole('img', {
        name: '18 of the 96 answers we need',
      })
      expect(arc).toHaveClass('hidden', 'lg:block')
      expect(screen.getByText('Heard').closest('ul')).toHaveClass(
        'hidden',
        'lg:flex',
      )
      const bar = screen.getByRole('progressbar', {
        name: '18 of the 96 answers we need',
      })
      expect(bar).toHaveClass('lg:hidden')
      expect(bar).not.toHaveClass('hidden')
    })

    it('holds back the themes, the map and the comparison behind one line', () => {
      renderView(early())

      expect(
        screen.getByText(
          "We'll show what people said once every group has enough answers, so a few loud voices can't tip the read.",
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

    it('names the groups it still needs', () => {
      renderView(early())

      expect(
        screen.getByText('Still need: men and people 65 and over.'),
      ).toBeInTheDocument()
      expect(screen.queryByText(/haven't answered/)).not.toBeInTheDocument()
      expect(screen.queryByText('Hear from more')).not.toBeInTheDocument()
    })

    it('asks for a few more answers when every group has some', () => {
      renderView(
        results({
          readStatus: {
            answers: 40,
            needed: 46,
            groupsHeard: 10,
            groupsTotal: 12,
            good: false,
            status: 'notYetRepresentative',
            underrepresented: ['age65plus', 'age55to64'],
            unheard: [],
            checkOut: true,
          },
        }),
      )

      expect(
        screen.getByRole('heading', { name: 'A few groups need more answers' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Still need: people 65 and over and people 55 to 64.'),
      ).toBeInTheDocument()
    })

    it('waits on enough answers when the district could not be read', () => {
      renderView(
        results({
          readStatus: {
            answers: 30,
            needed: 100,
            groupsHeard: 0,
            groupsTotal: 0,
            good: false,
            status: 'tooEarly',
            underrepresented: [],
            checkOut: true,
          },
        }),
      )

      expect(
        screen.getByText(
          "We'll show what we heard once enough people have answered.",
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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
          representativeAnswers: 96,
          representativeNeeded: 96,
          good: false,
          status: 'gettingClose',
          underrepresented: ['unreachedAreas'],
          checkOut: true,
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
      screen.getByText('Still unsure what people in a few neighborhoods think'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: '96 of the 96 answers we need' }),
    ).toBeInTheDocument()
    // Every answer in but the model not sure yet: a full bar in the
    // warning tone, never the success one.
    const bar = screen.getByRole('progressbar', {
      name: '96 of the 96 answers we need',
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

  it('says there are no themes yet when too few people have answered', () => {
    renderView(results({ themes: [], summarizing: false }))

    expect(
      screen.getByText('Themes show up once at least 5 people have answered.'),
    ).toBeInTheDocument()
  })

  it('says the themes are on their way while the first summary runs', () => {
    renderView(results({ themes: [], summarizing: true }))

    expect(
      screen.getByText(
        "We're reading what people said. Themes show up here soon.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Themes show up once at least 5 people have answered.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Updating with the latest answers.'),
    ).not.toBeInTheDocument()
  })

  it('keeps the themes up while new answers are being added', () => {
    renderView(results({ summarizing: true }))

    expect(screen.getByText('Drains back up into homes')).toBeInTheDocument()
    expect(
      screen.getByText('Updating with the latest answers.'),
    ).toBeInTheDocument()
  })

  it("draws the read's groups as petals against the district", () => {
    renderView(results())

    expect(screen.getByTestId('civic-panel-bloom')).toBeInTheDocument()
    expect(
      screen.getAllByRole('img', {
        name: '2 of 3 groups have at least their share of answers.',
      }).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('50% of its share').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Invite more/)).not.toBeInTheDocument()
    expect(screen.queryByText('Rent their home')).not.toBeInTheDocument()
  })

  it('says when the district census figures are unavailable', () => {
    renderView(results({ groups: [] }))

    expect(
      screen.getByText(
        'Census figures for your district are not available yet. Email support@goodparty.org so we can look into it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('civic-panel-bloom')).not.toBeInTheDocument()
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
      themes: 1,
    })
  })

  it('leaves the themes out while the results are held back', () => {
    renderView(
      results({
        readStatus: {
          answers: 5,
          needed: 20,
          groupsHeard: 2,
          groupsTotal: 12,
          good: false,
          status: 'tooEarly',
          underrepresented: [],
        },
      }),
    )

    const [, properties] =
      vi
        .mocked(trackEvent)
        .mock.calls.find(
          ([event]) => event === EVENTS.Priorities.ResultsViewed,
        ) ?? []
    expect(properties).toMatchObject({ heldBack: true })
    expect(properties).not.toHaveProperty('themes')
  })
})
