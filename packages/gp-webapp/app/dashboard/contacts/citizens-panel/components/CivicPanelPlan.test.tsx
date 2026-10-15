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

const withPlan = (
  steps: CivicPanelBuildStep[],
  next: CivicPanelBuildNext | null = NEXT_TEXT,
  hoursPerWeek = 1,
): CivicPanelBuildPlanResponse => ({
  plan: {
    id: 'plan-1',
    status: 'active',
    goalMembers: 100,
    hoursPerWeek,
    currentWave: Math.max(...steps.map((s) => s.wave)),
    createdAt: new Date('2026-10-15T12:00:00Z'),
    completedAt: null,
    steps,
  },
  next,
  progress: { members: 61, goal: 100 },
})

const NO_PLAN: CivicPanelBuildPlanResponse = {
  plan: null,
  next: null,
  progress: { members: 0, goal: 100 },
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

  it('says when nobody is left to reach, and where to go instead', async () => {
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
    expect(
      screen.getByRole('link', {
        name: 'Ask your Chief of Staff for another way to start.',
      }),
    ).toHaveAttribute('href', '/dashboard/chief-of-staff')
  })
})

describe('the plan', () => {
  it('lists each step with its status in plain words, the current wave first', () => {
    renderPage(
      withPlan(
        [
          step({ id: 'old-text', status: 'done', startedAt: new Date() }),
          step({
            id: 'old-calls',
            channel: 'phone_banking',
            targetSize: 45,
            status: 'skipped',
          }),
          step({
            id: 'new-text',
            wave: 2,
            targetSize: 1_200,
            status: 'waiting_on_replies',
            startedAt: new Date(),
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
          }),
          { ...DOORS, wave: 2 },
          step({
            id: 'new-doors-2',
            wave: 2,
            channel: 'door_knocking',
            position: 2,
            targetSize: 60,
          }),
        ],
        null,
      ),
    )

    expect(
      within(rowOf('Text 1,200 residents')).getByText(
        'Waiting on replies until October 23',
      ),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 30 residents')).getByText('In progress'),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 30 residents')).getByRole('link', {
        name: 'Keep calling',
      }),
    ).toHaveAttribute('href', '/dashboard/outreach/phone-banking/12')
    expect(
      within(rowOf('Knock on 100 doors in a walkable area')).getByText(
        'Not started',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Knock on 60 doors in a second walkable area'),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Text 3,150 residents')).getByText('Done'),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Call 45 residents')).getByText('Skipped'),
    ).toBeInTheDocument()
    expect(
      within(rowOf('Text 1,200 residents')).queryByRole('button'),
    ).toBeNull()
    const labels = screen.getAllByText(/^(Up now|Earlier)$/)
    expect(labels.map((l) => l.textContent)).toEqual(['Up now', 'Earlier'])
  })

  it('shows Next and members against the goal in the rail', () => {
    renderPage(withPlan([TEXT, CALLS]))

    const rail = screen.getByTestId('civic-panel-rail')
    expect(within(rail).getByText('61 of 100 members')).toBeInTheDocument()
    expect(
      within(rail).getByRole('link', {
        name: 'Invite residents to your civic panel by text',
      }),
    ).toHaveAttribute(
      'href',
      '/dashboard/contacts/citizens-panel?step=step-text',
    )
    expect(within(rail).queryByText(/representative/i)).toBeNull()
  })

  it('shows a Next with nothing to press as plain words', () => {
    renderPage(
      withPlan([step({ id: 'step-text', status: 'waiting_on_replies' })], {
        stepId: 'step-text',
        channel: 'text',
        status: 'waiting_on_replies',
        line: 'Replies to your civic panel invite should be in by Thursday, October 23',
        href: null,
      }),
    )

    const rail = screen.getByTestId('civic-panel-rail')
    expect(
      within(rail).getByText(
        'Replies to your civic panel invite should be in by Thursday, October 23',
      ),
    ).toBeInTheDocument()
    expect(within(rail).queryByRole('link')).toBeNull()
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

  it('opens phone banking on the call list', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 200,
      data: {
        stepId: 'step-calls',
        channel: 'phone_banking',
        voterFileFilterId: 8,
        purpose: 'introduce_myself',
        size: 30,
        area: null,
      },
    })
    renderPage(withPlan([TEXT, CALLS]))

    await user.click(screen.getByRole('button', { name: 'Start the calls' }))

    const flow = await screen.findByTestId('phone-banking-flow')
    expect(flow).toHaveAttribute('data-list', '8')
    expect(flow).toHaveAttribute('data-purpose', 'introduce_myself')
  })

  it('opens door knocking on the walkable area’s list', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 200,
      data: {
        stepId: 'step-doors',
        channel: 'door_knocking',
        voterFileFilterId: 9,
        purpose: 'introduce_myself',
        size: 100,
        area: null,
      },
    })
    renderPage(withPlan([TEXT, DOORS]))

    await user.click(
      screen.getByRole('button', { name: 'Start door knocking' }),
    )

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/dashboard/door-knocking?create=1&listId=9',
      ),
    )
  })

  it('says so next to the step when its list cannot be drawn', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 409,
      data: { message: 'Nobody is left to invite this way' },
    })
    renderPage(withPlan([TEXT, CALLS]))

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
    renderPage(withPlan([TEXT, CALLS]))

    await user.click(
      within(rowOf('Call 30 residents')).getByRole('button', { name: 'Skip' }),
    )

    expect(
      await within(rowOf('Call 30 residents')).findByText('Skipped'),
    ).toBeInTheDocument()
    expect(skipped).toBe('step-calls')
  })
})

describe('changing the weekly time', () => {
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
