import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, format, isWeekend, startOfDay } from 'date-fns'
import type {
  CivicPanelSummary,
  ManagedCivicPanel,
  OnboardingFocus,
  FocusOption,
  ResidentVoicesResponse,
} from '@goodparty_org/contracts'
import type {
  ElectedOffice,
  ElectedOfficeInput,
  MeetingsListItemDto,
  Organization,
} from 'gpApi/api-endpoints'
import { SnackbarProvider } from '@shared/utils/Snackbar'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { longDay, monthDay } from './firstMeeting'

vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual = await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('@shared/experiments/serveCitizenPanelsFlag', () => ({
  SERVE_CITIZEN_PANELS_FLAG_KEY: 'serve-citizen-panels',
  useServeCitizenPanelsFlag: () => ({ ready: true, enabled: false }),
}))

// The canvas and its physics are covered in confetti.test.ts. Here the flow
// only has to ask for the right thing at the right moment.
const confetti = vi.hoisted(() => ({
  pour: vi.fn(),
  burst: vi.fn(),
  addSurface: vi.fn(),
  clear: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('./confetti', () => ({ createConfetti: () => confetti }))

const impersonation = vi.hoisted(() => ({ active: false }))
vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => impersonation.active,
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Anna', lastName: 'Whitlock' },
    () => undefined,
    false,
  ],
}))

import { trackEvent } from 'helpers/analyticsHelper'
import ServeOnboardingFlow from '../ServeOnboardingFlow'

const trackEventMock = vi.mocked(trackEvent)

const eventProps = (name: string): Record<string, unknown>[] =>
  trackEventMock.mock.calls
    .filter(([eventName]) => eventName === name)
    .map(([, props]) => (props ?? {}) as Record<string, unknown>)

const EO_ID = 'eo-uuid-1'
const TODAY = startOfDay(new Date())
const FIRST_MEETING = addDays(TODAY, 12)
const iso = (day: Date): string => format(day, 'yyyy-MM-dd')

// A winner's office as gp-api leaves it: the campaign linked, the stepper's
// own checkpoint, no term dates and nothing finished.
const buildOffice = (
  overrides: Partial<ElectedOffice> = {},
): ElectedOffice => ({
  id: EO_ID,
  swornInDate: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
  termLengthDays: null,
  isActive: false,
  party: 'independent',
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: 'confirm',
  campaignId: 7,
  votesReceived: 6812,
  briefingTextReminderAt: null,
  ...overrides,
})

const ORG = {
  slug: `eo-${EO_ID}`,
  positionName: 'Northampton City Council',
  position: { brPositionId: 'position-1' },
  district: { l2Name: 'NORTHAMPTON CITY' },
  electedOfficeId: EO_ID,
  campaignId: null,
  status: 'active',
} as Organization

const meetingRow = (
  day: Date,
  overrides: Partial<MeetingsListItemDto> = {},
): MeetingsListItemDto => ({
  meetingDate: iso(day),
  meetingTime: '19:00',
  meetingTimezone: 'America/New_York',
  durationMinutes: 120,
  meetingName: 'City Council',
  location: 'City Hall, 210 Main Street',
  hasBriefing: false,
  ...overrides,
})

const VOICES: ResidentVoicesResponse = {
  voices: [
    {
      id: 'v1',
      quote: 'The crossing by the school needs a guard.',
      lat: 42.3251,
      lon: -72.6412,
      synthetic: false,
    },
    {
      id: 'v2',
      quote: 'Our street floods every time it rains hard.',
      lat: 42.3176,
      lon: -72.6311,
      synthetic: true,
    },
  ],
  syntheticCount: 1,
}

const card = (overrides: Partial<FocusOption> = {}): FocusOption => ({
  key: 'c1',
  kind: 'community',
  title: 'The flyering rule downtown',
  description: '',
  residentInterest: 'high',
  firstWin: 'weeks',
  recapLine: 'the flyering rule',
  ...overrides,
})

const CARDS: FocusOption[] = [
  card(),
  card({
    key: 'c2',
    title: 'The downtown street redesign',
    firstWin: 'year_or_more',
    recapLine: 'the downtown street redesign',
  }),
  card({
    key: 'c3',
    title: 'A crossing guard at the school',
    residentInterest: 'low',
    firstWin: 'months',
    recapLine: 'a crossing guard at the school',
  }),
]

interface Calls {
  saves: ElectedOfficeInput[]
  panel: {
    inviteMessage: string
    consentVersion: string
    firstSendDate?: string
  }[]
  focus: { shownKeys: string[]; focusKey: string }[]
  stated: { meetingDate: string; meetingTime: string }[]
  cleared: number
}

const mockLoad = ({
  office = buildOffice(),
  meetings = [meetingRow(FIRST_MEETING), meetingRow(addDays(TODAY, 40))],
  population = 29571 as number | null,
  voices = VOICES,
  goal = 240 as number | null,
  built = null as { firstSendDate: string } | null,
  focus = { kind: 'community', options: CARDS } as Pick<
    OnboardingFocus,
    'kind' | 'options'
  >,
}: {
  office?: ElectedOffice
  meetings?: MeetingsListItemDto[]
  population?: number | null
  voices?: ResidentVoicesResponse
  // Null stands for an office that cannot have a Civic Panel.
  goal?: number | null
  built?: { firstSendDate: string } | null
  focus?: Pick<OnboardingFocus, 'kind' | 'options'>
} = {}): Calls => {
  const calls: Calls = {
    saves: [],
    panel: [],
    focus: [],
    stated: [],
    cleared: 0,
  }
  api.mock('GET /v1/elected-office/current', { status: 200, data: office })
  api.mock('GET /v1/elected-office/mine', {
    status: 200,
    data: [
      {
        ...office,
        hasWinIssues: false,
        campaignWasEverPro: true,
        prepared: false,
      },
    ],
  })
  api.mock('GET /v1/organizations/:slug', { status: 200, data: ORG })
  api.mock('GET /v1/meetings', {
    status: 200,
    data: { scheduleKnown: meetings.length > 0, meetings },
  })
  api.mock('GET /v1/onboarding/contacts/stats', {
    status: 200,
    data: {
      districtId: 'district-1',
      computedAt: '2026-08-01T00:00:00.000Z',
      totalConstituents: 21000,
      totalConstituentsWithCellPhone: 15000,
      districtPopulation: population,
      buckets: {
        age: [],
        homeowner: [],
        education: [],
        presenceOfChildren: [],
        estimatedIncomeRange: [],
      },
    },
  })
  api.mock('PUT /v1/elected-office/:id', ({ body }) => {
    calls.saves.push(body)
    return { status: 200, data: { ...office, ...body } as ElectedOffice }
  })
  api.mock('GET /v1/resident-voices', { status: 200, data: voices })
  const panel = built
    ? ({
        status: 'building',
        progress: { firstSendDate: built.firstSendDate },
      } as ManagedCivicPanel)
    : null
  if (goal === null) {
    api.mock('GET /v1/contacts/civic-panel', {
      status: 404,
      data: { message: 'Not Found' },
    })
    api.mock('GET /v1/contacts/civic-panel/managed', {
      status: 404,
      data: { message: 'Not Found' },
    })
  } else {
    api.mock('GET /v1/contacts/civic-panel', {
      status: 200,
      data: { progress: { goal } } as CivicPanelSummary,
    })
    api.mock('GET /v1/contacts/civic-panel/managed', {
      status: 200,
      data: { panel },
    })
  }
  api.mock('POST /v1/contacts/civic-panel/managed', ({ body }) => {
    calls.panel.push(body)
    return { status: 200, data: { panel: null } }
  })
  api.mock('POST /v1/community-issues/onboarding', {
    status: 200,
    data: { queued: true },
  })
  api.mock('GET /v1/priorities/onboarding/focus', {
    status: 200,
    data: { ...focus, searchPending: false, saved: null },
  })
  api.mock('PUT /v1/priorities/onboarding/focus', ({ body }) => {
    calls.focus.push(body)
    const picked = focus.options.find((each) => each.key === body.focusKey)
    return {
      status: 200,
      data: {
        priorityId: 'priority-1',
        title: picked?.title ?? '',
        recapLine: picked?.recapLine ?? '',
      },
    }
  })
  api.mock('PUT /v1/meetings/first-meeting', ({ body }) => {
    calls.stated.push(body)
    return { status: 200, data: body }
  })
  api.mock('DELETE /v1/meetings/first-meeting', () => {
    calls.cleared += 1
    return { status: 200, data: undefined }
  })
  return calls
}

const renderFlow = () =>
  render(
    <SnackbarProvider>
      <ServeOnboardingFlow />
    </SnackbarProvider>,
  )

const heading = (name: string | RegExp) =>
  screen.findByRole('heading', { level: 1, name }, { timeout: 4000 })

const press = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> => {
  await user.click(
    await screen.findByRole('button', { name }, { timeout: 4000 }),
  )
}

const crumbs = (): string[] =>
  within(screen.getByRole('navigation', { name: 'Steps' }))
    .getAllByRole('button')
    .map((crumb) => crumb.textContent ?? '')

const paragraph = (text: string) =>
  screen.getByText(
    (_, node) => node?.tagName === 'P' && node.textContent === text,
  )

// The handoffs between screens are timed motion. With reduced motion every
// end state shows at once, so a test can walk the whole flow quickly.
const reduceMotion = (): void => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

const realMatchMedia = window.matchMedia

beforeEach(() => {
  trackEventMock.mockClear()
  Object.values(confetti).forEach((mock) => mock.mockClear())
  testQueryClient.clear()
  impersonation.active = false
})

afterEach(() => {
  window.matchMedia = realMatchMedia
})

const swornDay = (): Date => {
  let day = FIRST_MEETING
  while (isWeekend(day)) day = addDays(day, 1)
  return day
}

describe('the warm welcome', () => {
  it('walks a winner through all six steps to Done', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const calls = mockLoad()
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(crumbs()).toEqual([
      'You won',
      'First meeting',
      'Meeting Briefing',
      'Residents',
      'Priorities',
      'Recap',
    ])
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(
      paragraph(
        'All of Northampton is counting on you now, not just the people who voted. Let’s get you ready for that.',
      ),
    ).toBeInTheDocument()

    await press(user, 'Let’s get ready')
    expect(
      await heading(
        `It looks like your first City Council meeting is ${longDay(FIRST_MEETING)} at 7:00 pm.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('City Hall')).toBeInTheDocument()
    expect(screen.getByText('210 Main Street')).toBeInTheDocument()
    expect(paragraph('Does that sound right?')).toBeInTheDocument()

    await press(user, 'Yes, that’s it')
    expect(
      await heading(`${longDay(FIRST_MEETING)} it is.`),
    ).toBeInTheDocument()
    const google = screen.getByRole('link', { name: 'Google' })
    expect(google).toHaveAttribute(
      'href',
      expect.stringContaining('https://calendar.google.com/calendar/render'),
    )
    expect(screen.getByRole('link', { name: '.ics file' })).toHaveAttribute(
      'download',
      'City Council meeting.ics',
    )
    google.addEventListener('click', (event) => event.preventDefault())
    await user.click(google)
    expect(
      await screen.findByText('Opened in Google Calendar.'),
    ).toBeInTheDocument()

    await press(user, 'Let’s keep going')
    expect(
      await heading(
        'Your first Meeting Briefing should be ready around 2 days before your meeting.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Documents dropping into a folder called Anna Whitlock’s Meeting Briefing',
      }),
    ).toBeInTheDocument()
    expect(
      paragraph('Want a reminder via text when it’s ready?'),
    ).toBeInTheDocument()

    await press(user, 'Remind me')
    expect(
      await screen.findByRole('button', { name: 'You got it' }),
    ).toBeDisabled()
    expect(
      await heading('Here’s what people in Northampton are saying.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(calls.saves).toContainEqual({ briefingTextReminder: true }),
    )
    expect(
      screen.getByText(
        '*Some comments are synthesized from real ones in similar places.',
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('The crossing by the school needs a guard.'),
    ).toBeInTheDocument()

    await press(user, 'Next')
    expect(
      await heading('Most officials only hear from the loudest voices.'),
    ).toBeInTheDocument()
    expect(
      paragraph(
        'Let’s change that. In about two weeks we can have 240 Northampton residents from every part of town ready to answer your questions. Want to set that up?',
      ),
    ).toBeInTheDocument()

    await press(user, 'Yes')
    expect(await heading('Here’s the text we’ll send.')).toBeInTheDocument()
    const editable = screen.getByRole('textbox', {
      name: 'The part of the invitation you can change',
    })
    expect(editable).toHaveTextContent(
      'this is Anna Whitlock, your Northampton City Council Member-elect.',
    )
    expect(
      screen.getByText(/Reply JOIN to share your perspectives\./),
    ).toBeInTheDocument()

    await press(user, 'Pick a day')
    expect(
      await heading('When should the first invites go out?'),
    ).toBeInTheDocument()
    expect(
      paragraph('Texts go out at 11 am Northampton time.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Set it up' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /After I’m sworn in/ }))
    await press(user, 'Set it up')
    expect(
      await heading(`All set! We’ll start texting on ${longDay(swornDay())}.`),
    ).toBeInTheDocument()
    expect(calls.panel).toHaveLength(1)
    expect(calls.panel[0]?.firstSendDate).toBe(iso(swornDay()))
    expect(calls.panel[0]?.consentVersion).toBe(
      'warm-welcome-set-it-up-2026-11-25',
    )
    // Sent once they hold the office, so the invite no longer says "-elect".
    expect(calls.panel[0]?.inviteMessage).toBe(
      'Hi {{first_name}}, this is Anna Whitlock, your Northampton City Council Member.\n\nI’d like to hear from residents who want a voice in our community. So, I’m inviting a select group of neighbors to share their views. I’ll text you about once a month to ask what you think. If you’d like to be part of this civic panel, please reply with JOIN.\n\nThis is a nonpartisan panel. Your replies come straight to me, and I won’t share them publicly without asking you first.\n\nReply JOIN to share your perspectives.\nReply STOP to opt out.',
    )

    await press(user, 'Let’s keep going')
    expect(
      await heading('Let’s get another win under your belt.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'These issues are important to your community, pick one to start.',
      ),
    ).toBeInTheDocument()
    const cards = screen.getAllByRole('radio')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveTextContent('The flyering rule downtown')
    expect(cards[0]).toHaveTextContent('Resident interestHigh')
    expect(cards[0]).toHaveTextContent('First winWeeks')
    expect(cards[1]).toHaveTextContent('First winA year or more')
    expect(cards[2]).toHaveTextContent('Resident interestLow')
    expect(
      screen.queryByRole('button', { name: 'Start with this' }),
    ).not.toBeInTheDocument()

    await user.click(cards[0]!)
    expect(await screen.findByText('Great choice.')).toBeInTheDocument()
    await press(user, 'Start with this')
    expect(await heading('You’re all set, Anna.')).toBeInTheDocument()
    expect(calls.focus).toEqual([
      { shownKeys: ['c1', 'c2', 'c3'], focusKey: 'c1' },
    ])

    const recap = screen.getByRole('region', { name: 'Recap' })
    expect(
      within(recap).getByText(
        (_, node) =>
          node?.tagName === 'P' &&
          node.textContent ===
            `Your Meeting Briefing for ${monthDay(FIRST_MEETING)} should be readyaround 2 days before.`,
      ),
    ).toBeInTheDocument()
    expect(
      within(recap).getByText(
        (_, node) =>
          node?.tagName === 'P' &&
          node.textContent ===
            'We’ll help you make progress onthe flyering rule.',
      ),
    ).toBeInTheDocument()
    expect(
      within(recap).getByText(`Invites go out ${longDay(swornDay())}.`, {
        exact: false,
      }),
    ).toBeInTheDocument()

    await press(user, 'Done')
    await waitFor(() =>
      expect(calls.saves.at(-1)).toMatchObject({
        party: 'independent',
        onboardingStep: 'warm-recap',
        termStartDate: iso(FIRST_MEETING),
      }),
    )
    expect(calls.saves.at(-1)?.onboardingCompletedAt).toEqual(
      expect.any(String),
    )
    expect(calls.saves.at(-1)).not.toHaveProperty('pledgedAt')
    expect(
      calls.saves.map((save) => save.onboardingStep).filter(Boolean),
    ).toEqual([
      'warm-meeting',
      'warm-briefing',
      'warm-residents',
      'warm-priorities',
      'warm-recap',
      'warm-recap',
    ])

    expect(eventProps('Serve Onboarding - First Meeting Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        meetingAnswer: 'confirmed',
        calendar: 'google',
      },
    ])
    expect(eventProps('Serve Onboarding - Meeting Briefing Completed')).toEqual(
      [{ electedOfficeId: EO_ID, textReminder: true }],
    )
    expect(eventProps('Serve Onboarding - Residents Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        civicPanel: 'set_up',
        sawComments: true,
        editedInvite: false,
        firstSendChoice: 'sworn',
      },
    ])
    expect(eventProps('Serve Onboarding - First Focus Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        shown: 3,
        kind: 'community',
        focusKind: 'community',
        residentInterest: 'high',
        firstWin: 'weeks',
      },
    ])
    await waitFor(() =>
      expect(eventProps('Serve Onboarding - Net New Completed')).toEqual([
        { electedOfficeId: EO_ID, flow: 'warm_welcome' },
      ]),
    )
    for (const step of [
      'You Won',
      'First Meeting',
      'Meeting Briefing',
      'Residents',
      'First Focus',
      'Recap',
    ]) {
      expect(
        eventProps(`Serve Onboarding - ${step} Viewed`).length,
      ).toBeGreaterThan(0)
    }
  }, 30_000)

  it('counts the people who voted for them first, with confetti', async () => {
    mockLoad()
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.getByText('People who voted for you')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '6,812' })).toBeInTheDocument()
    await waitFor(() => expect(confetti.pour).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    })
    expect(eventProps('Serve Onboarding - You Won Viewed')).toEqual([
      { electedOfficeId: EO_ID },
    ])
  })

  it('shows the one number for a winner with no vote count', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({ office: buildOffice({ votesReceived: null }) })
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.getByText('People you now serve')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '29,571' })).toBeInTheDocument()
    expect(
      screen.queryByText('People who voted for you'),
    ).not.toBeInTheDocument()

    await press(user, 'Let’s get ready')
    await waitFor(() =>
      expect(eventProps('Serve Onboarding - You Won Completed')).toEqual([
        { electedOfficeId: EO_ID, hasPopulation: true, hasVotes: false },
      ]),
    )
  })

  it('leaves the card out when there is no number at all', async () => {
    reduceMotion()
    mockLoad({
      office: buildOffice({ votesReceived: null }),
      population: null,
    })
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.queryByText('People you now serve')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Let’s get ready' }),
    ).toBeInTheDocument()
  })

  it('saves a date the official corrects, so the briefing follows it', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const calls = mockLoad({
      office: buildOffice({ onboardingStep: 'warm-meeting' }),
    })
    renderFlow()

    await press(user, 'That’s not right')
    expect(await heading('No problem. When is it?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Time' }))
    await user.click(
      within(screen.getByRole('group', { name: 'Times' })).getByRole('button', {
        name: '6:30 pm',
      }),
    )
    await press(user, 'Use this date')
    expect(
      await heading(`${longDay(FIRST_MEETING)} it is.`),
    ).toBeInTheDocument()
    expect(calls.stated).toEqual([
      { meetingDate: iso(FIRST_MEETING), meetingTime: '18:30' },
    ])
    expect(
      screen.getByText(`${longDay(FIRST_MEETING)}, 6:30 to 8:30 pm`),
    ).toBeInTheDocument()

    await press(user, 'Let’s keep going')
    expect(
      await heading(/Your first Meeting Briefing should be ready/),
    ).toBeInTheDocument()
    expect(eventProps('Serve Onboarding - First Meeting Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        meetingAnswer: 'corrected',
        calendar: null,
      },
    ])
  })

  it('stays on the date when a correction cannot be saved', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({ office: buildOffice({ onboardingStep: 'warm-meeting' }) })
    api.mock('PUT /v1/meetings/first-meeting', {
      status: 500,
      data: { message: 'boom' },
    })
    renderFlow()

    await press(user, 'That’s not right')
    await user.click(await screen.findByRole('button', { name: 'Time' }))
    await user.click(
      within(screen.getByRole('group', { name: 'Times' })).getByRole('button', {
        name: '6:30 pm',
      }),
    )
    await press(user, 'Use this date')
    expect(
      await screen.findByText('We couldn’t save that date. Please try again.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'No problem. When is it?',
      }),
    ).toBeInTheDocument()
  })

  it('skips the briefing when they do not know the date yet', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const calls = mockLoad({
      office: buildOffice({ onboardingStep: 'warm-meeting' }),
    })
    renderFlow()

    await press(user, 'That’s not right')
    await press(user, 'I don’t know yet')
    expect(
      await heading('That’s okay. We’ll find it and let you know.'),
    ).toBeInTheDocument()
    expect(
      paragraph('The city posts its meeting calendar. We check it every day.'),
    ).toBeInTheDocument()
    expect(crumbs()).not.toContain('Meeting Briefing')

    await press(user, 'Keep going')
    expect(
      await heading('Here’s what people in Northampton are saying.'),
    ).toBeInTheDocument()
    expect(calls.stated).toEqual([])
  })

  it('opens Residents on the ask when the district has no comments', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({
      office: buildOffice({ onboardingStep: 'warm-residents' }),
      voices: { voices: [], syntheticCount: 0 },
    })
    renderFlow()

    expect(
      await heading('Most officials only hear from the loudest voices.'),
    ).toBeInTheDocument()
    await press(user, 'Skip for now')
    expect(
      await heading('Let’s get another win under your belt.'),
    ).toBeInTheDocument()
    expect(eventProps('Serve Onboarding - Residents Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        civicPanel: 'skipped',
        sawComments: false,
        editedInvite: false,
        firstSendChoice: null,
      },
    ])
  })

  it('shows the comments and moves on when no Civic Panel can be offered', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({
      office: buildOffice({ onboardingStep: 'warm-residents' }),
      goal: null,
    })
    renderFlow()

    expect(
      await heading('Here’s what people in Northampton are saying.'),
    ).toBeInTheDocument()
    await press(user, 'Next')
    expect(
      await heading('Let’s get another win under your belt.'),
    ).toBeInTheDocument()
  })

  it('leaves Residents out with no comments and no Civic Panel', async () => {
    reduceMotion()
    mockLoad({ voices: { voices: [], syntheticCount: 0 }, goal: null })
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(crumbs()).toEqual([
      'You won',
      'First meeting',
      'Meeting Briefing',
      'Priorities',
      'Recap',
    ])
  })

  it('does not ask again once a Civic Panel is being built', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const firstSend = addDays(TODAY, 20)
    const calls = mockLoad({
      office: buildOffice({ onboardingStep: 'warm-residents' }),
      built: { firstSendDate: iso(firstSend) },
    })
    renderFlow()

    await press(user, 'Next')
    expect(
      await heading(`All set! We’ll start texting on ${longDay(firstSend)}.`),
    ).toBeInTheDocument()
    expect(calls.panel).toEqual([])
  })

  it('lets them change the invite and start tomorrow as the official-elect', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const calls = mockLoad({
      office: buildOffice({ onboardingStep: 'warm-residents' }),
      voices: { voices: [], syntheticCount: 0 },
    })
    renderFlow()

    await press(user, 'Yes')
    await press(user, 'Edit message')
    const editable = screen.getByRole('textbox', {
      name: 'The part of the invitation you can change',
    })
    await user.type(editable, ' Thank you!')
    await press(user, 'Done editing')
    await press(user, 'Pick a day')
    const [first] = await screen.findAllByRole('radio')
    await user.click(first!)
    await press(user, 'Set it up')
    await waitFor(() => expect(calls.panel).toHaveLength(1))
    expect(calls.panel[0]?.inviteMessage).toContain(
      'your Northampton City Council Member-elect.',
    )
    expect(calls.panel[0]?.inviteMessage).toContain(
      'please reply with JOIN. Thank you!\n\nThis is a nonpartisan panel.',
    )
  })

  it('stays on the day when the Civic Panel cannot be set up', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({
      office: buildOffice({ onboardingStep: 'warm-residents' }),
      voices: { voices: [], syntheticCount: 0 },
    })
    api.mock('POST /v1/contacts/civic-panel/managed', {
      status: 500,
      data: { message: 'boom' },
    })
    renderFlow()

    await press(user, 'Yes')
    await press(user, 'Pick a day')
    const [first] = await screen.findAllByRole('radio')
    await user.click(first!)
    await press(user, 'Set it up')
    expect(
      await screen.findByText(
        'We couldn’t set up your Civic Panel. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'When should the first invites go out?',
      }),
    ).toBeInTheDocument()
  })

  it('names what they ran on, and leaves Priorities out with no issues', async () => {
    reduceMotion()
    mockLoad({
      office: buildOffice({ onboardingStep: 'warm-priorities' }),
      focus: {
        kind: 'ran_on',
        options: [
          card({ key: 'p1', kind: 'ran_on', title: 'Slow the traffic' }),
        ],
      },
    })
    const first = renderFlow()
    expect(
      await screen.findByText('Here’s what you ran on, pick one to start.'),
    ).toBeInTheDocument()
    first.unmount()

    testQueryClient.clear()
    mockLoad({ focus: { kind: 'community', options: [] } })
    renderFlow()
    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(crumbs()).not.toContain('Priorities')
  })

  it('offers the Civic Panel again from the recap when it was skipped', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({
      office: buildOffice({ onboardingStep: 'warm-recap' }),
      meetings: [],
    })
    renderFlow()

    expect(await heading('You’re all set, Anna.')).toBeInTheDocument()
    const recap = screen.getByRole('region', { name: 'Recap' })
    expect(
      within(recap).getByText('We’ll help you get ready for it.'),
    ).toBeInTheDocument()
    expect(
      within(recap).getByText(
        'prepare for meetings, draft ordinances, and connect with residents.',
      ),
    ).toBeInTheDocument()
    expect(
      within(recap).getByText(
        'We can gather 240 neighbors you can ask anything, by text.',
      ),
    ).toBeInTheDocument()

    await press(user, 'See how the Civic Panel works')
    expect(
      await heading('Most officials only hear from the loudest voices.'),
    ).toBeInTheDocument()
  })

  it('finishes with no term date when they never confirmed a meeting', async () => {
    reduceMotion()
    const user = userEvent.setup()
    const calls = mockLoad({
      office: buildOffice({ onboardingStep: 'warm-recap' }),
      meetings: [],
    })
    renderFlow()

    await press(user, 'Done')
    await waitFor(() =>
      expect(calls.saves.at(-1)).toMatchObject({
        onboardingStep: 'warm-recap',
      }),
    )
    expect(calls.saves.at(-1)).not.toHaveProperty('termStartDate')
  })

  it('says so and stays when Done cannot be saved', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({ office: buildOffice({ onboardingStep: 'warm-recap' }) })
    api.mock('PUT /v1/elected-office/:id', {
      status: 500,
      data: { message: 'boom' },
    })
    renderFlow()

    await press(user, 'Done')
    expect(
      await screen.findByText(
        'We couldn’t finish setting up your office. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    expect(eventProps('Serve Onboarding - Net New Completed')).toEqual([])
  })

  it('goes back a step from the footer and from the breadcrumb', async () => {
    reduceMotion()
    const user = userEvent.setup()
    mockLoad({ office: buildOffice({ onboardingStep: 'warm-briefing' }) })
    renderFlow()

    expect(
      await heading(/Your first Meeting Briefing should be ready/),
    ).toBeInTheDocument()
    await press(user, 'Back')
    expect(await heading(/It looks like your first/)).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('navigation', { name: 'Steps' })).getByRole(
        'button',
        { name: 'You won' },
      ),
    )
    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
  })

  it('tells an impersonating admin to leave without finishing', async () => {
    reduceMotion()
    impersonation.active = true
    mockLoad()
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.getByText(/Impersonation mode/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})

describe('who gets the warm welcome', () => {
  const stepperLoads = async (): Promise<void> => {
    await waitFor(
      () =>
        expect(
          screen.queryByRole('navigation', { name: 'Steps' }),
        ).not.toBeInTheDocument(),
      { timeout: 3000 },
    )
  }

  it('is not shown for an office that did not come from a win', async () => {
    reduceMotion()
    mockLoad({ office: buildOffice({ campaignId: null }) })
    renderFlow()
    await stepperLoads()
    expect(
      screen.queryByRole('heading', { name: 'Well done, Anna. You won!' }),
    ).not.toBeInTheDocument()
  })

  it('is not shown to a winner in a major party, who gets the party step', async () => {
    reduceMotion()
    mockLoad({ office: buildOffice({ party: 'democratic' }) })
    renderFlow()
    await stepperLoads()
    expect(
      screen.queryByRole('heading', { name: 'Well done, Anna. You won!' }),
    ).not.toBeInTheDocument()
  })

  it('is shown to a winner whose office has no term dates', async () => {
    reduceMotion()
    mockLoad()
    renderFlow()
    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
  })
})
