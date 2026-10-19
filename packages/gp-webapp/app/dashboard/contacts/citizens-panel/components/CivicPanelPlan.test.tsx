import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'
import type {
  CivicPanelBuildNext,
  CivicPanelBuildPlanResponse,
  CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { CitizensPanelView } from './CitizensPanelView'

const smsFlag = vi.hoisted(() => ({ ready: true, enabled: true }))

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => smsFlag,
}))

// The flows are their own suites; here only what the page opens them with.
vi.mock('app/dashboard/outreach/v2/sms/SmsFlow', () => ({
  SERVE_SMS_SURFACE: {},
  SmsFlow: (props: {
    preselectedListId?: number
    initialPurpose?: string
    audienceSettled?: boolean
  }) => (
    <div
      data-testid="sms-flow"
      data-list={props.preselectedListId}
      data-purpose={props.initialPurpose}
      data-settled={String(props.audienceSettled)}
    />
  ),
}))

vi.mock('app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow', () => ({
  SERVE_PHONE_BANKING_SURFACE: {},
  PhoneBankingFlow: (props: {
    preselectedListId?: number
    initialPurpose?: string
  }) => (
    <div
      data-testid="phone-banking-flow"
      data-list={props.preselectedListId}
      data-purpose={props.initialPurpose}
    />
  ),
}))

const SUMMARY = {
  members: 0,
  reachedRecently: 0,
  askableNow: 0,
  lastOutreachAt: null,
}

const step = (
  overrides: Partial<CivicPanelBuildStep> & Pick<CivicPanelBuildStep, 'id'>,
): CivicPanelBuildStep => ({
  wave: 1,
  channel: 'text',
  position: 1,
  targetSize: 3_150,
  status: 'not_started',
  voterFileFilterId: null,
  outreachId: null,
  phoneBankingListId: null,
  doorKnockingTurfId: null,
  startedAt: null,
  completedAt: null,
  expectedRepliesBy: null,
  markedDone: null,
  reached: null,
  joined: null,
  steeredToward: null,
  ...overrides,
})

const TEXT = step({ id: 'step-text' })
const CALLS = step({
  id: 'step-calls',
  channel: 'phone_banking',
  targetSize: 30,
})
const DOORS = step({
  id: 'step-doors',
  channel: 'door_knocking',
  targetSize: 100,
})

const NEXT_TEXT: CivicPanelBuildNext = {
  stepId: 'step-text',
  channel: 'text',
  status: 'not_started',
  line: 'Invite residents to your civic panel by text',
  href: '/dashboard/contacts/citizens-panel?step=step-text',
}

const NEXT_CALLS: CivicPanelBuildNext = {
  stepId: 'step-calls',
  channel: 'phone_banking',
  status: 'not_started',
  line: 'Call residents to invite them to your civic panel',
  href: '/dashboard/contacts/citizens-panel?step=step-calls',
}

const NEXT_DOORS: CivicPanelBuildNext = {
  stepId: 'step-doors',
  channel: 'door_knocking',
  status: 'not_started',
  line: 'Knock on doors to invite residents to your civic panel',
  href: '/dashboard/contacts/citizens-panel?step=step-doors',
}

const withPlan = (
  steps: CivicPanelBuildStep[],
  next: CivicPanelBuildNext | null = NEXT_TEXT,
  hoursPerWeek = 1,
): CivicPanelBuildPlanResponse => ({
  plan: {
    id: 'plan-1',
    status: 'active',
    goalMembers: 240,
    hoursPerWeek,
    currentWave: Math.max(...steps.map((s) => s.wave)),
    createdAt: new Date('2026-10-15T12:00:00Z'),
    completedAt: null,
    steps,
  },
  next,
  progress: { members: 60, goal: 240, answersNeeded: 96, expectedAnswers: 24 },
  balance: null,
})

// How far the bar is filled, in percent.
const filledShare = (top: HTMLElement) =>
  top.querySelector('[data-slot="progress"]')?.getAttribute('data-filled')

const NO_PLAN: CivicPanelBuildPlanResponse = {
  plan: null,
  next: null,
  progress: { members: 0, goal: 240, answersNeeded: 96, expectedAnswers: 0 },
  balance: null,
}

const renderPage = (plan: CivicPanelBuildPlanResponse | null) =>
  render(
    <CitizensPanelView
      summary={SUMMARY}
      representation={{ representation: null }}
      plan={plan}
    />,
  )

const rowOf = (title: string) => {
  const row = screen.getByText(title).closest('li')
  if (!row) throw new Error(`no row for ${title}`)
  return row
}

beforeEach(() => {
  smsFlag.ready = true
  smsFlag.enabled = true
  vi.mocked(router.push!).mockClear()
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams() as ReturnType<typeof useSearchParams>,
  )
})

describe('the weekly time question', () => {
  it('starts on an hour a week and makes the plan from it', async () => {
    const user = userEvent.setup()
    let sent: unknown
    api.mock('POST /v1/contacts/civic-panel/plan', ({ body }) => {
      sent = body
      return { status: 200, data: withPlan([TEXT, CALLS]) }
    })
    renderPage(NO_PLAN)

    expect(
      screen.getByRole('heading', {
        name: 'How much time can you give each week?',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1 hour a week' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /0/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Make my plan' }))

    expect(await screen.findByText('Text 3,150 residents')).toBeInTheDocument()
    expect(sent).toEqual({ hoursPerWeek: 1 })
    expect(screen.getByText('1 hour a week')).toBeInTheDocument()
  })

  it('takes more time typed in, and says what to fix in an odd answer', async () => {
    const user = userEvent.setup()
    let sent: unknown
    api.mock('POST /v1/contacts/civic-panel/plan', ({ body }) => {
      sent = body
      return { status: 200, data: withPlan([TEXT], NEXT_TEXT, 6) }
    })
    renderPage(NO_PLAN)

    await user.click(
      screen.getByRole('radio', { name: '4 or more hours a week' }),
    )
    const field = screen.getByLabelText('Hours each week')
    await user.clear(field)
    const button = screen.getByRole('button', { name: 'Make my plan' })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(
      screen.getByText('Enter a number of hours, like 5.'),
    ).toBeInTheDocument()

    await user.type(field, '0')
    await user.click(button)
    expect(
      screen.getByText('Enter a whole number from 1 to 20.'),
    ).toBeInTheDocument()
    expect(sent).toBeUndefined()

    await user.clear(field)
    await user.type(field, '6')
    await user.click(button)
    expect(await screen.findByText('6 hours a week')).toBeInTheDocument()
    expect(sent).toEqual({ hoursPerWeek: 6 })
  })

  it('says when nobody is left to reach, with no other way to start', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan', {
      status: 409,
      data: { message: 'Everyone we can reach has already been invited' },
    })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: NO_PLAN,
    })
    renderPage(NO_PLAN)

    await user.click(screen.getByRole('button', { name: 'Make my plan' }))

    expect(
      await screen.findByText(/Everyone we can reach has already been invited/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Chief of Staff/ })).toBeNull()
  })
})

describe('the plan', () => {
  it('leads with the next step, its one action and Skip', () => {
    renderPage(withPlan([TEXT, CALLS, DOORS], NEXT_CALLS))

    const featured = rowOf('Call 30 residents')
    expect(
      within(featured).getByRole('heading', { name: 'Call 30 residents' }),
    ).toBeInTheDocument()
    expect(
      within(featured).getByText(
        "People a text can't reach, landlines first. About 2 hours of your time.",
      ),
    ).toBeInTheDocument()
    expect(
      within(featured).getByRole('button', { name: 'Start the calls' }),
    ).toBeInTheDocument()
    expect(
      within(featured).getByRole('button', { name: 'Skip' }),
    ).toBeInTheDocument()
    expect(
      within(featured).getByRole('checkbox', { name: 'Mark done' }),
    ).not.toBeChecked()

    expect(
      within(rowOf('Text 3,150 residents')).getByRole('button', {
        name: 'Get started',
      }),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Knock on 100 doors in a walkable area')).getByText(
        'One walkable area. About 5 hours of your time.',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(1)
    expect(screen.queryByText(/^(Up now|Earlier|Not started)$/)).toBeNull()
  })

  it('names who a round leans toward, never how', () => {
    renderPage(
      withPlan([
        step({ id: 'step-text', steeredToward: 'age65plus' }),
        step({
          id: 'step-doors',
          channel: 'door_knocking',
          targetSize: 100,
          steeredToward: 'unreachedAreas',
        }),
      ]),
    )

    expect(
      within(rowOf('Text 3,150 residents')).getByText(
        'This round invites more people 65 and over.',
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Knock on 100 doors in a walkable area')).getByText(
        "A part of your district we haven't reached. About 5 hours of your time.",
      ),
    ).toBeInTheDocument()
  })

  it('says landlines first on a call step only while its round puts them first', () => {
    renderPage(
      withPlan([
        CALLS,
        step({
          id: 'step-calls-2',
          wave: 2,
          channel: 'phone_banking',
          targetSize: 40,
          steeredToward: 'age18to64',
        }),
      ]),
    )

    expect(
      within(rowOf('Call 30 residents')).getByText(
        "People a text can't reach, landlines first. About 2 hours of your time.",
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 40 residents')).getByText(
        /^People a text can't reach\. About .+ of your time\.$/,
      ),
    ).toBeInTheDocument()
  })

  it('checks off done steps at the bottom, a sent text included, and hides skipped ones', () => {
    renderPage(
      withPlan(
        [
          step({
            id: 'old-text',
            targetSize: 1_200,
            status: 'done',
            startedAt: new Date('2026-09-10T12:00:00'),
            expectedRepliesBy: new Date('2026-09-17T12:00:00'),
            joined: 31,
          }),
          step({
            id: 'old-calls',
            channel: 'phone_banking',
            targetSize: 45,
            status: 'skipped',
          }),
          step({
            id: 'new-text',
            wave: 2,
            targetSize: 900,
            status: 'waiting_on_replies',
            startedAt: new Date('2026-10-14T12:00:00'),
            expectedRepliesBy: new Date('2026-10-23T12:00:00'),
          }),
          step({
            id: 'new-calls',
            wave: 2,
            channel: 'phone_banking',
            targetSize: 30,
            status: 'in_progress',
            startedAt: new Date(),
            phoneBankingListId: 12,
            reached: 12,
          }),
          step({
            id: 'done-doors',
            wave: 2,
            channel: 'door_knocking',
            targetSize: 60,
            status: 'done',
            reached: 58,
            joined: 6,
          }),
        ],
        null,
      ),
    )

    expect(screen.queryByText('Call 45 residents')).toBeNull()
    expect(
      within(rowOf('Text 900 residents')).getByText(
        'Sent Oct 20. Replies come in by Oct 23.',
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Text 900 residents')).getByRole('checkbox'),
    ).toBeChecked()
    expect(
      within(rowOf('Text 900 residents')).getByRole('checkbox'),
    ).toBeDisabled()
    expect(
      within(rowOf('Text 1,200 residents')).getByText(
        'Sent Sep 14. 31 joined.',
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Knock on 60 doors in a walkable area')).getByText(
        'Visited 58 residents. 6 joined.',
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 30 residents')).getByText('Called 12 so far.'),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 30 residents')).getByRole('link', {
        name: 'Keep calling',
      }),
    ).toHaveAttribute('href', '/dashboard/outreach/phone-banking/12')
    const titles = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p, h3')?.textContent)
    expect(titles).toEqual([
      'Call 30 residents',
      'Text 900 residents',
      'Knock on 60 doors in a walkable area',
      'Text 1,200 residents',
    ])
    expect(screen.queryByText(/Waiting on replies/)).toBeNull()
  })

  it('ticks a call step done by hand, and unticks it', async () => {
    const user = userEvent.setup()
    const sent: unknown[] = []
    api.mock(
      'POST /v1/contacts/civic-panel/plan/steps/:id/mark',
      ({ body }) => {
        sent.push(body)
        const done = (body as { done: boolean }).done
        return {
          status: 200,
          data: withPlan(
            [
              TEXT,
              {
                ...CALLS,
                status: done ? 'done' : 'not_started',
                markedDone: done,
              },
            ],
            NEXT_TEXT,
          ),
        }
      },
    )
    renderPage(withPlan([TEXT, CALLS]))

    await user.click(
      within(rowOf('Call 30 residents')).getByRole('checkbox', {
        name: 'Mark done',
      }),
    )
    await waitFor(() =>
      expect(
        within(rowOf('Call 30 residents')).getByRole('checkbox', {
          name: 'Mark not done',
        }),
      ).toBeChecked(),
    )
    await user.click(
      within(rowOf('Call 30 residents')).getByRole('checkbox', {
        name: 'Mark not done',
      }),
    )
    await waitFor(() =>
      expect(
        within(rowOf('Call 30 residents')).getByRole('checkbox', {
          name: 'Mark done',
        }),
      ).not.toBeChecked(),
    )
    expect(sent).toEqual([{ done: true }, { done: false }])
    expect(
      within(rowOf('Text 3,150 residents')).getByRole('checkbox'),
    ).toBeDisabled()
  })

  it('shows members toward the goal at the top, above the plan', () => {
    renderPage(withPlan([TEXT, CALLS]))

    const top = screen.getByTestId('civic-panel-progress')
    expect(top).toHaveTextContent('60 of 240 members')
    expect(
      within(top).getByText('About 24 answers per question today'),
    ).toBeInTheDocument()
    expect(
      within(top).getByText(
        'About 4 in 10 members answer each question, so 240 members gets you the 96 answers you need.',
      ),
    ).toBeInTheDocument()
    expect(filledShare(top)).toBe('25')
    expect(
      top.compareDocumentPosition(screen.getByText('Your plan')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByText(/representative/i)).toBeNull()
  })

  it('shows an empty bar above the hours question before a plan', () => {
    renderPage(NO_PLAN)

    const top = screen.getByTestId('civic-panel-progress')
    expect(top).toHaveTextContent('0 of 240 members')
    expect(filledShare(top)).toBe('0')
    expect(
      top.compareDocumentPosition(
        screen.getByRole('heading', {
          name: 'How much time can you give each week?',
        }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByTestId('civic-panel-rail')).toBeNull()
  })

  it('fills the bar once the panel reaches its goal', () => {
    renderPage({
      ...withPlan([TEXT]),
      progress: {
        members: 250,
        goal: 240,
        answersNeeded: 96,
        expectedAnswers: 100,
      },
    })

    const top = screen.getByTestId('civic-panel-progress')
    expect(top).toHaveTextContent('250 of 240 members')
    expect(filledShare(top)).toBe('100')
  })

  it('highlights the step a Next link opened', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('step=step-calls') as ReturnType<
        typeof useSearchParams
      >,
    )
    renderPage(withPlan([TEXT, CALLS]))

    expect(rowOf('Call 30 residents')).toHaveAttribute('data-focused', 'true')
    expect(rowOf('Text 3,150 residents')).toHaveAttribute(
      'data-focused',
      'false',
    )
  })
})

describe('starting a step', () => {
  it('opens the text flow on the panel invite with its list picked', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 200,
      data: {
        stepId: 'step-text',
        channel: 'text',
        voterFileFilterId: 7,
        purpose: 'build_citizens_panel',
        size: 3_150,
        area: null,
      },
    })
    renderPage(withPlan([TEXT, CALLS]))

    await user.click(screen.getByRole('button', { name: 'Start the text' }))

    const flow = await screen.findByTestId('sms-flow')
    expect(flow).toHaveAttribute('data-list', '7')
    expect(flow).toHaveAttribute('data-purpose', 'build_citizens_panel')
    expect(flow).toHaveAttribute('data-settled', 'true')
  })

  it('opens phone banking on the call list with the panel invite', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 200,
      data: {
        stepId: 'step-calls',
        channel: 'phone_banking',
        voterFileFilterId: 8,
        purpose: 'build_citizens_panel',
        size: 30,
        area: null,
      },
    })
    renderPage(withPlan([TEXT, CALLS]))

    await user.click(
      within(rowOf('Call 30 residents')).getByRole('button', {
        name: 'Get started',
      }),
    )

    const flow = await screen.findByTestId('phone-banking-flow')
    expect(flow).toHaveAttribute('data-list', '8')
    expect(flow).toHaveAttribute('data-purpose', 'build_citizens_panel')
  })

  it('opens door knocking on the walkable area, its list and the panel invite', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 200,
      data: {
        stepId: 'step-doors',
        channel: 'door_knocking',
        voterFileFilterId: 9,
        purpose: 'build_citizens_panel',
        size: 100,
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [-97.75, 30.25],
              [-97.74, 30.25],
              [-97.74, 30.26],
              [-97.75, 30.26],
              [-97.75, 30.25],
            ],
          ],
        },
      },
    })
    renderPage(withPlan([TEXT, DOORS], NEXT_DOORS))

    await user.click(
      screen.getByRole('button', { name: 'Start door knocking' }),
    )

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/dashboard/door-knocking?create=1&listId=9&purpose=build_citizens_panel&area=-97.75%2C30.25%2C-97.74%2C30.26',
      ),
    )
  })

  it('says so next to the step when its list cannot be drawn', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 409,
      data: { message: 'Nobody is left to invite this way' },
    })
    renderPage(withPlan([TEXT, CALLS], NEXT_CALLS))

    await user.click(screen.getByRole('button', { name: 'Start the calls' }))

    expect(
      await within(rowOf('Call 30 residents')).findByText(
        "We couldn't get this step ready. Try again.",
      ),
    ).toBeInTheDocument()
  })

  it('offers no text while texting is off for the office', () => {
    smsFlag.enabled = false
    renderPage(withPlan([TEXT, CALLS]))

    expect(screen.queryByRole('button', { name: 'Start the text' })).toBeNull()
    expect(
      screen.getByText("Texting isn't set up for your office yet."),
    ).toBeInTheDocument()
  })

  it('skips a step nobody started', async () => {
    const user = userEvent.setup()
    let skipped: string | undefined
    api.mock(
      'POST /v1/contacts/civic-panel/plan/steps/:id/skip',
      ({ params }) => {
        skipped = params.id
        return {
          status: 200,
          data: withPlan([TEXT, { ...CALLS, status: 'skipped' }]),
        }
      },
    )
    renderPage(withPlan([TEXT, CALLS], NEXT_CALLS))

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(screen.queryByText('Call 30 residents')).not.toBeInTheDocument(),
    )
    expect(skipped).toBe('step-calls')
  })
})

describe('changing the weekly time', () => {
  it('shows your time beside the plan', () => {
    renderPage(withPlan([TEXT, CALLS]))

    const rail = screen.getByTestId('civic-panel-rail')
    expect(within(rail).getByText('Your time')).toBeInTheDocument()
    expect(within(rail).getByText('1 hour a week')).toBeInTheDocument()
    expect(
      within(rail).getByRole('button', { name: 'Change your weekly time' }),
    ).toHaveTextContent('Change')
    expect(within(rail).queryByText('Next')).toBeNull()
  })

  it('saves new weekly time from the rail', async () => {
    const user = userEvent.setup()
    let sent: unknown
    api.mock('PATCH /v1/contacts/civic-panel/plan', ({ body }) => {
      sent = body
      return { status: 200, data: withPlan([TEXT, CALLS], NEXT_TEXT, 3) }
    })
    renderPage(withPlan([TEXT, CALLS]))

    const rail = screen.getByTestId('civic-panel-rail')
    expect(within(rail).getByText('1 hour a week')).toBeInTheDocument()
    await user.click(
      within(rail).getByRole('button', { name: 'Change your weekly time' }),
    )
    expect(
      within(rail).getByRole('radio', { name: '1 hour a week' }),
    ).toBeChecked()
    await user.click(
      within(rail).getByRole('radio', { name: '3 hours a week' }),
    )
    await user.click(
      within(rail).getByRole('button', { name: 'Save weekly time' }),
    )

    expect(await within(rail).findByText('3 hours a week')).toBeInTheDocument()
    expect(sent).toEqual({ hoursPerWeek: 3 })
  })
})
