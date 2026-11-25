import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, format, startOfDay } from 'date-fns'
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

const warmWelcomeFlag = vi.hoisted(() => ({ ready: true, enabled: true }))
vi.mock('@shared/experiments/serveWarmWelcomeFlag', () => ({
  SERVE_WARM_WELCOME_FLAG_KEY: 'serve-warm-welcome',
  useServeWarmWelcomeFlag: () => warmWelcomeFlag,
}))

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
const TERM_START = addDays(TODAY, 30)
const FIRST_MEETING = addDays(TODAY, 33)
const iso = (day: Date): string => format(day, 'yyyy-MM-dd')

// A winner's office as gp-api leaves it once BallotReady has their term: the
// campaign linked, the stepper's own checkpoint, and nothing finished.
const buildOffice = (
  overrides: Partial<ElectedOffice> = {},
): ElectedOffice => ({
  id: EO_ID,
  swornInDate: null,
  electedDate: null,
  termStartDate: iso(TERM_START),
  termEndDate: iso(addDays(TERM_START, 4 * 365)),
  termLengthDays: 4 * 365,
  isActive: false,
  party: 'independent',
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: 'confirm',
  campaignId: 7,
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

const mockLoad = ({
  office = buildOffice(),
  meetings = [meetingRow(addDays(TODAY, 5)), meetingRow(FIRST_MEETING)],
  population = 29571 as number | null,
}: {
  office?: ElectedOffice
  meetings?: MeetingsListItemDto[]
  population?: number | null
} = {}): { saves: ElectedOfficeInput[] } => {
  const saves: ElectedOfficeInput[] = []
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
    saves.push(body)
    return { status: 200, data: { ...office, ...body } as ElectedOffice }
  })
  return { saves }
}

const renderFlow = () =>
  render(
    <SnackbarProvider>
      <ServeOnboardingFlow />
    </SnackbarProvider>,
  )

const heading = (name: string | RegExp) =>
  screen.findByRole('heading', { level: 1, name })

const press = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> => {
  await user.click(await screen.findByRole('button', { name }))
}

const crumbs = (): string[] =>
  within(screen.getByRole('navigation', { name: 'Steps' }))
    .getAllByRole('button')
    .map((crumb) => crumb.textContent ?? '')

beforeEach(() => {
  trackEventMock.mockClear()
  Object.values(confetti).forEach((mock) => mock.mockClear())
  testQueryClient.clear()
  warmWelcomeFlag.enabled = true
  impersonation.active = false
})

describe('the warm welcome', () => {
  it('walks a winner from the win to Done', async () => {
    const user = userEvent.setup()
    const { saves } = mockLoad()
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.getByText('People you now serve')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '29,571' })).toBeInTheDocument()
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === 'P' &&
          node.textContent ===
            'All of Northampton is counting on you now, not just the people who voted. Let’s get you ready for that.',
      ),
    ).toBeInTheDocument()
    expect(crumbs()).toEqual([
      'You won',
      'First meeting',
      'Meeting Briefing',
      'Recap',
    ])
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    await waitFor(() => expect(confetti.pour).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    })

    await press(user, 'Let’s get ready')
    // Leaving the win fades its confetti away.
    await waitFor(() => expect(confetti.clear).toHaveBeenCalled())
    // The first meeting in their term, not the one before they take office.
    expect(
      await heading(
        `It looks like your first City Council meeting is ${longDay(FIRST_MEETING)} at 7:00 pm.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('City Hall')).toBeInTheDocument()
    expect(screen.getByText('210 Main Street')).toBeInTheDocument()
    expect(screen.getByText('Does that sound right?')).toBeInTheDocument()

    await press(user, 'Yes, that’s it')
    expect(
      await heading(`${longDay(FIRST_MEETING)} it is.`),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`${longDay(FIRST_MEETING)}, 7:00 to 9:00 pm`),
    ).toBeInTheDocument()
    const google = screen.getByRole('link', { name: 'Google' })
    expect(google).toHaveAttribute(
      'href',
      expect.stringContaining('https://calendar.google.com/calendar/render'),
    )
    expect(google).toHaveAttribute('target', '_blank')
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
    // A 7 pm meeting is picked up by the daily run two days before it.
    const ready = longDay(addDays(FIRST_MEETING, -2))
    expect(
      await heading(`Your first Meeting Briefing will be ready by ${ready}.`),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Documents dropping into a folder with Anna Whitlock’s name on it',
      }),
    ).toBeInTheDocument()

    await press(user, 'Let’s keep going')
    expect(await heading('You’re all set, Anna.')).toBeInTheDocument()
    // The step before is still sliding away, so read the recap's own region.
    const recap = within(screen.getByRole('region', { name: 'Recap' }))
    expect(
      recap.getByText(
        `Your Meeting Briefing for ${monthDay(FIRST_MEETING)} lands on`,
        { exact: false },
      ),
    ).toBeInTheDocument()
    expect(recap.getByText(`${ready}.`)).toBeInTheDocument()
    expect(
      recap.getByText(
        'prepare for meetings, draft ordinances, and connect with residents.',
      ),
    ).toBeInTheDocument()

    await press(user, 'Done')
    await waitFor(() =>
      expect(saves.some((save) => save.onboardingCompletedAt)).toBe(true),
    )

    // Each step is a checkpoint on the way, then Done is the completion
    // save: the party, the completion stamp, and nothing about a pledge
    // nobody was shown or a term nobody was asked for.
    expect(saves.map((save) => save.onboardingStep)).toEqual([
      'warm-meeting',
      'warm-briefing',
      'warm-recap',
      'warm-recap',
    ])
    const completion = saves[saves.length - 1]!
    expect(Object.keys(completion).sort()).toEqual([
      'onboardingCompletedAt',
      'onboardingStep',
      'party',
    ])
    expect(completion.party).toBe('independent')

    expect(eventProps('Serve Onboarding - You Won Viewed')).toHaveLength(1)
    expect(eventProps('Serve Onboarding - You Won Completed')).toEqual([
      { electedOfficeId: EO_ID, hasPopulation: true },
    ])
    expect(eventProps('Serve Onboarding - First Meeting Completed')).toEqual([
      {
        electedOfficeId: EO_ID,
        meetingAnswer: 'confirmed',
        calendar: 'google',
      },
    ])
    expect(
      eventProps('Serve Onboarding - Meeting Briefing Completed'),
    ).toHaveLength(1)
    expect(eventProps('Serve Onboarding - Recap Viewed')).toHaveLength(1)
    await waitFor(() =>
      expect(eventProps('Serve Onboarding - Net New Completed')).toEqual([
        { electedOfficeId: EO_ID, flow: 'warm_welcome' },
      ]),
    )
    expect(eventProps('Serve Onboarding - Recap Completed')).toHaveLength(1)
    expect(eventProps('Serve Onboarding - Pledge Completed')).toHaveLength(0)
  })

  // The schedule gp-api holds is unchanged by a correction, so no briefing
  // day is promised for it: the briefing step leaves, and the recap says
  // when their meeting is instead.
  it('keeps a corrected date for the calendar and the recap, and promises no briefing day for it', async () => {
    const user = userEvent.setup()
    mockLoad()
    renderFlow()

    await press(user, 'Let’s get ready')
    await press(user, 'That’s not right')
    expect(await heading('No problem. When is it?')).toBeInTheDocument()

    // The sentence starts on the date we found; move it one day later.
    const corrected = addDays(FIRST_MEETING, 1)
    await user.click(screen.getByRole('button', { name: 'Day' }))
    const calendar = await screen.findByRole('dialog')
    await user.click(
      calendar.querySelector(
        `button[data-day="${corrected.toLocaleDateString()}"]`,
      ) as HTMLElement,
    )
    await press(user, 'Use this date')

    expect(await heading(`${longDay(corrected)} it is.`)).toBeInTheDocument()
    expect(crumbs()).toEqual(['You won', 'First meeting', 'Recap'])

    await press(user, 'Let’s keep going')
    await heading('You’re all set, Anna.')
    const recap = within(screen.getByRole('region', { name: 'Recap' }))
    expect(
      recap.getByText('Your first City Council meeting is', { exact: false }),
    ).toBeInTheDocument()
    expect(
      recap.getByText(`${longDay(corrected)} at 7:00 pm.`),
    ).toBeInTheDocument()
    expect(eventProps('Serve Onboarding - First Meeting Completed')).toEqual([
      { electedOfficeId: EO_ID, meetingAnswer: 'corrected', calendar: null },
    ])
  })

  it('counts the sentence left as we found it as a yes', async () => {
    const user = userEvent.setup()
    mockLoad()
    renderFlow()

    await press(user, 'Let’s get ready')
    await press(user, 'That’s not right')
    await press(user, 'Use this date')
    await heading(`${longDay(FIRST_MEETING)} it is.`)
    expect(crumbs()).toEqual([
      'You won',
      'First meeting',
      'Meeting Briefing',
      'Recap',
    ])
  })

  // A briefing for a meeting this close starts whenever the office goes
  // live, so there is no day to promise.
  it('promises no briefing day for a meeting that is tomorrow', async () => {
    const user = userEvent.setup()
    mockLoad({
      office: buildOffice({ termStartDate: iso(addDays(TODAY, -5)) }),
      meetings: [meetingRow(addDays(TODAY, 1))],
    })
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(crumbs()).toEqual(['You won', 'First meeting', 'Recap'])
    await press(user, 'Let’s get ready')
    await press(user, 'Yes, that’s it')
    await press(user, 'Let’s keep going')
    await heading('You’re all set, Anna.')
    expect(
      within(screen.getByRole('region', { name: 'Recap' })).getByText(
        `${longDay(addDays(TODAY, 1))} at 7:00 pm.`,
      ),
    ).toBeInTheDocument()
  })

  it('skips the briefing when the official does not know the date yet', async () => {
    const user = userEvent.setup()
    mockLoad()
    renderFlow()

    await press(user, 'Let’s get ready')
    await press(user, 'That’s not right')
    await press(user, 'I don’t know yet')
    expect(
      await heading('That’s okay. We’ll find it and let you know.'),
    ).toBeInTheDocument()
    // A step that leaves the flow leaves the breadcrumb too.
    expect(crumbs()).toEqual(['You won', 'First meeting', 'Recap'])

    await press(user, 'Keep going')
    expect(await heading('You’re all set, Anna.')).toBeInTheDocument()
    expect(
      screen.getByText('You won. Next up is your first meeting.', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('We’ll help you get ready for it.'),
    ).toBeInTheDocument()
    expect(eventProps('Serve Onboarding - First Meeting Completed')).toEqual([
      { electedOfficeId: EO_ID, meetingAnswer: 'unknown', calendar: null },
    ])
  })

  it('goes from the win to the recap when no meeting has been found', async () => {
    const user = userEvent.setup()
    mockLoad({ meetings: [], population: null })
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    // No number we can stand behind, so no card.
    expect(screen.queryByText('People you now serve')).not.toBeInTheDocument()
    expect(crumbs()).toEqual(['You won', 'Recap'])

    await press(user, 'Let’s get ready')
    expect(await heading('You’re all set, Anna.')).toBeInTheDocument()
    expect(
      screen.getByText('We’ll help you get ready for it.'),
    ).toBeInTheDocument()
    expect(eventProps('Serve Onboarding - You Won Completed')).toEqual([
      { electedOfficeId: EO_ID, hasPopulation: false },
    ])
  })

  it('goes back by the footer and by the breadcrumb, never ahead', async () => {
    const user = userEvent.setup()
    mockLoad()
    renderFlow()

    await press(user, 'Let’s get ready')
    await heading(/It looks like your first City Council meeting is/)
    const nav = screen.getByRole('navigation', { name: 'Steps' })
    expect(
      within(nav).getByRole('button', { name: 'First meeting' }),
    ).toHaveAttribute('aria-current', 'step')
    expect(
      within(nav).getByRole('button', { name: 'Meeting Briefing' }),
    ).toBeDisabled()

    await press(user, 'Back')
    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()

    await press(user, 'Let’s get ready')
    await heading(/It looks like your first City Council meeting is/)
    await user.click(within(nav).getByRole('button', { name: 'You won' }))
    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    // Entering a step again counts as a view each time.
    expect(eventProps('Serve Onboarding - You Won Viewed')).toHaveLength(3)
  })

  it('resumes at the step the official had reached', async () => {
    mockLoad({ office: buildOffice({ onboardingStep: 'warm-briefing' }) })
    renderFlow()

    expect(
      await heading(/Your first Meeting Briefing will be ready by/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  it('keeps the official on the recap when the completion save fails', async () => {
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled(),
    )
    expect(eventProps('Serve Onboarding - Net New Completed')).toHaveLength(0)
  })

  it('lets an impersonating admin leave without finishing it', async () => {
    impersonation.active = true
    mockLoad()
    renderFlow()

    expect(await heading('Well done, Anna. You won!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})

describe('who gets the warm welcome', () => {
  const STEPPER_TERM_TITLE = 'When does your term run?'

  it('leaves everyone on the stepper onboarding while the flag is off', async () => {
    warmWelcomeFlag.enabled = false
    mockLoad()
    renderFlow()

    expect(await heading('Does this look right?')).toBeInTheDocument()
    expect(
      screen.queryByText('Well done, Anna. You won!'),
    ).not.toBeInTheDocument()
  })

  // Done cannot make the completion save without a term, and the warm
  // welcome has no screen that asks for one.
  it('keeps the stepper, which asks for the term, when the office has no term dates', async () => {
    mockLoad({
      office: buildOffice({ termStartDate: null, termEndDate: null }),
    })
    renderFlow()

    expect(await heading(STEPPER_TERM_TITLE)).toBeInTheDocument()
  })

  it('keeps the stepper, with its party step, for a major party', async () => {
    mockLoad({ office: buildOffice({ party: 'democratic' }) })
    renderFlow()

    expect(await heading(/party designation/i)).toBeInTheDocument()
  })

  it('keeps the stepper for an office that did not come from a win', async () => {
    mockLoad({ office: buildOffice({ campaignId: null }) })
    renderFlow()

    expect(await heading('Does this look right?')).toBeInTheDocument()
  })
})
