import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { PriorityResults } from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PriorityResultsView } from './PriorityResultsView'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const place = vi.hoisted(() => ({ current: 'Asheville' as string | null }))

vi.mock('app/dashboard/contacts/citizens-panel/managedPanelCopy', () => ({
  useServePlace: () => place.current,
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
  beforeEach(() => {
    place.current = 'Asheville'
  })

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

  it('numbers the themes in the order they come, first as #1', () => {
    renderView(
      results({
        themes: [
          { id: 't1', title: 'Drains', summary: 'Overflow.', people: 14 },
          { id: 't2', title: 'Insurance', summary: 'Premiums.', people: 9 },
        ],
      }),
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('#1')
    expect(items[0]).toHaveTextContent('Drains')
    expect(items[1]).toHaveTextContent('#2')
    expect(items[1]).toHaveTextContent('Insurance')
    expect(screen.getByLabelText('Rank 1')).toHaveTextContent('#1')
    expect(screen.getByLabelText('Rank 2')).toHaveTextContent('#2')
  })

  const signalThemes = results({
    themes: [
      {
        id: 't1',
        title: 'Drains',
        summary: 'Overflow.',
        people: 14,
        voices: 'strong',
      },
      {
        id: 't2',
        title: 'Insurance',
        summary: 'Premiums.',
        people: 9,
        voices: 'fair',
      },
      {
        id: 't3',
        title: 'Parking',
        summary: 'Too few spots.',
        people: 4,
        voices: 'thin',
      },
    ],
  })

  it('labels each theme by how strong a signal it is, in color', () => {
    renderView(signalThemes)

    expect(screen.getByText('Strong signal')).toHaveClass(
      'bg-success-background',
      'text-success-dark',
    )
    expect(screen.getByText('Some signal')).toHaveClass(
      'bg-warning-background',
      'text-warning-dark',
    )
    expect(screen.getByText('Low signal')).toHaveClass(
      'bg-error-background',
      'text-error-dark',
    )
    expect(screen.queryByText(/Enough voices/)).not.toBeInTheDocument()
  })

  it.each([
    [
      'strong signal',
      'Every group in Asheville had enough people weigh in on this.',
    ],
    [
      'some signal',
      'At least half the groups in Asheville had enough people weigh in on this.',
    ],
    [
      'low signal',
      'Fewer than half the groups in Asheville had enough people weigh in on this.',
    ],
  ])('explains %s one tap away', async (label, meaning) => {
    // A touch tap, the phone case openOnClick exists for: a mouse click
    // would hover-open the tooltip and then toggle it shut.
    const user = userEvent.setup()
    renderView(signalThemes)

    expect(screen.queryByText(meaning)).not.toBeInTheDocument()

    await user.pointer({
      keys: '[TouchA]',
      target: screen.getByRole('button', { name: `What does ${label} mean?` }),
    })

    expect((await screen.findAllByText(meaning)).length).toBeGreaterThan(0)
  })

  it('opens the meaning from the keyboard', async () => {
    const user = userEvent.setup()
    renderView(signalThemes)

    await user.tab()
    while (
      document.activeElement !==
      screen.getByRole('button', { name: 'What does strong signal mean?' })
    ) {
      await user.tab()
    }

    expect(
      (
        await screen.findAllByText(
          'Every group in Asheville had enough people weigh in on this.',
        )
      ).length,
    ).toBeGreaterThan(0)
  })

  it('says your district when the place is not known', async () => {
    place.current = null
    const user = userEvent.setup()
    renderView(signalThemes)

    await user.pointer({
      keys: '[TouchA]',
      target: screen.getByRole('button', {
        name: 'What does strong signal mean?',
      }),
    })

    expect(
      (
        await screen.findAllByText(
          'Every group in your district had enough people weigh in on this.',
        )
      ).length,
    ).toBeGreaterThan(0)
  })

  it('shows no label when the district could not be read', () => {
    renderView(results())

    expect(screen.queryByText(/signal/)).not.toBeInTheDocument()
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

describe('PriorityResultsView theme responses', () => {
  beforeEach(() => {
    place.current = 'Asheville'
    api.reset()
  })

  it('opens a theme to read what people said, words only, and goes back', async () => {
    let asked: { id: string; themeId: string } | null = null
    api.mock(
      'GET /v1/priorities/:id/results/themes/:themeId/comments',
      ({ params }) => {
        asked = { id: params.id, themeId: params.themeId }
        return {
          status: 200,
          data: {
            themeId: 't1',
            comments: [
              { text: 'Water comes up through my floor drain.', kind: 'reply' },
              { text: 'She says the corner floods every storm.', kind: 'note' },
            ],
          },
        }
      },
    )
    const user = userEvent.setup()
    renderView(results())

    await user.click(screen.getByRole('button', { name: /view responses/i }))

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Drains back up into homes',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('14 people')).toBeInTheDocument()
    expect(
      await screen.findByText('Water comes up through my floor drain.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('She says the corner floods every storm.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Notes from a conversation')).toBeInTheDocument()
    expect(asked).toEqual({ id: 'p1', themeId: 't1' })
    // The poll reader's per-person controls stay off: nothing names or
    // opens a person.
    expect(
      screen.queryByRole('button', { name: /favorite/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /show details/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Top themes' }))

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'What we heard on Flooding',
      }),
    ).toBeInTheDocument()
  })

  it("downloads one theme's responses from the theme, and all of them from the list", async () => {
    api.mock('GET /v1/priorities/:id/results/themes/:themeId/comments', {
      status: 200,
      data: { themeId: 't1', comments: [] },
    })
    const user = userEvent.setup()
    renderView(results())

    expect(
      screen.getByRole('link', { name: 'Download all responses' }),
    ).toHaveAttribute('href', '/api/v1/priorities/p1/results/comments/download')

    await user.click(screen.getByRole('button', { name: /view responses/i }))

    const link = screen.getByRole('link', { name: 'Download responses' })
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/priorities/p1/results/comments/download?themeId=t1',
    )
    expect(link).toHaveAttribute('download')
    expect(
      await screen.findByText('No responses to show for this theme.'),
    ).toBeInTheDocument()
  })

  it('says so when the responses cannot be read', async () => {
    api.mock('GET /v1/priorities/:id/results/themes/:themeId/comments', {
      status: 500,
      data: {},
    })
    const user = userEvent.setup()
    renderView(results())

    await user.click(screen.getByRole('button', { name: /view responses/i }))

    expect(
      await screen.findByText("We couldn't load the responses. Try again."),
    ).toBeInTheDocument()
  })

  it('offers no responses or download while the results are held back', () => {
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

    expect(
      screen.queryByRole('button', { name: /view responses/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /download/i }),
    ).not.toBeInTheDocument()
  })
})
