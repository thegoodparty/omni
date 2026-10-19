import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  CivicPanelBuildNext,
  CivicPanelBuildPlanResponse,
  CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { CivicPanelNextStepCard } from './civicPanelWidgets'

const smsFlag = vi.hoisted(() => ({ ready: true, enabled: true }))

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  useServeSmsFlag: () => smsFlag,
}))

vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

// The flows are their own suites; here only what the card opens them with.
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

const step = (
  overrides: Partial<CivicPanelBuildStep> &
    Pick<CivicPanelBuildStep, 'id' | 'channel'>,
): CivicPanelBuildStep => ({
  wave: 1,
  position: 1,
  targetSize: 30,
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
  ...overrides,
})

const planWith = (
  next: CivicPanelBuildStep,
  line: string,
): CivicPanelBuildPlanResponse => {
  const nextStep: CivicPanelBuildNext = {
    stepId: next.id,
    channel: next.channel,
    status: next.status,
    line,
    href: `/dashboard/contacts/citizens-panel?step=${next.id}`,
  }
  return {
    plan: {
      id: 'plan-1',
      status: 'active',
      goalMembers: 240,
      hoursPerWeek: 2,
      currentWave: 1,
      createdAt: new Date('2026-10-15T12:00:00Z'),
      completedAt: null,
      steps: [next],
    },
    next: nextStep,
    progress: { members: 12, goal: 240, answersNeeded: 96, expectedAnswers: 5 },
  }
}

const prepared = (
  stepId: string,
  channel: CivicPanelBuildStep['channel'],
  voterFileFilterId: number,
) => ({
  status: 200 as const,
  data: {
    stepId,
    channel,
    voterFileFilterId,
    purpose: 'build_citizens_panel',
    size: 30,
    area: null,
  },
})

beforeEach(() => {
  testQueryClient.clear()
  smsFlag.ready = true
  smsFlag.enabled = true
  vi.mocked(router.push!).mockClear()
})

describe('CivicPanelNextStepCard', () => {
  it('opens the calls in the phone banking flow, not the panel page', async () => {
    const user = userEvent.setup()
    const calls = step({ id: 's-calls', channel: 'phone_banking' })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(calls, 'Call residents to invite them'),
    })
    let preparedId: string | undefined
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', (req) => {
      preparedId = req.params.id
      return prepared('s-calls', 'phone_banking', 8)
    })
    render(<CivicPanelNextStepCard />)

    await user.click(
      await screen.findByRole('button', { name: 'Start the calls' }),
    )

    const flow = await screen.findByTestId('phone-banking-flow')
    expect(preparedId).toBe('s-calls')
    expect(flow).toHaveAttribute('data-list', '8')
    expect(flow).toHaveAttribute('data-purpose', 'build_citizens_panel')
    expect(screen.getByRole('link', { name: 'See your plan' })).toHaveAttribute(
      'href',
      '/dashboard/contacts/citizens-panel?from=chief_of_staff_chat',
    )
  })

  it('opens the text on compose with the audience settled', async () => {
    const user = userEvent.setup()
    const text = step({ id: 's-text', channel: 'text', targetSize: 3_150 })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(text, 'Invite residents by text'),
    })
    api.mock(
      'POST /v1/contacts/civic-panel/plan/steps/:id/prepare',
      prepared('s-text', 'text', 7),
    )
    render(<CivicPanelNextStepCard />)

    await user.click(
      await screen.findByRole('button', { name: 'Start the text' }),
    )

    const flow = await screen.findByTestId('sms-flow')
    expect(flow).toHaveAttribute('data-list', '7')
    expect(flow).toHaveAttribute('data-settled', 'true')
  })

  it('takes the doors to the door knocking create flow', async () => {
    const user = userEvent.setup()
    const doors = step({ id: 's-doors', channel: 'door_knocking' })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(doors, 'Knock on doors to invite residents'),
    })
    api.mock(
      'POST /v1/contacts/civic-panel/plan/steps/:id/prepare',
      prepared('s-doors', 'door_knocking', 9),
    )
    render(<CivicPanelNextStepCard />)

    await user.click(
      await screen.findByRole('button', { name: 'Start door knocking' }),
    )

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/dashboard/door-knocking?create=1&listId=9&purpose=build_citizens_panel',
      ),
    )
  })

  it('links calls already underway to the caller page', async () => {
    const calls = step({
      id: 's-calls',
      channel: 'phone_banking',
      status: 'in_progress',
      phoneBankingListId: 42,
    })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(calls, 'Keep calling residents'),
    })
    render(<CivicPanelNextStepCard />)

    expect(
      await screen.findByRole('link', { name: 'Keep calling' }),
    ).toHaveAttribute('href', '/dashboard/outreach/phone-banking/42')
  })

  it('says so when the step could not be readied', async () => {
    const user = userEvent.setup()
    const calls = step({ id: 's-calls', channel: 'phone_banking' })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(calls, 'Call residents to invite them'),
    })
    api.mock('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', {
      status: 409,
      data: { message: 'Nobody is left to invite this way' },
    })
    render(<CivicPanelNextStepCard />)

    await user.click(
      await screen.findByRole('button', { name: 'Start the calls' }),
    )

    expect(
      await screen.findByText("We couldn't get this step ready. Try again."),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('phone-banking-flow')).toBeNull()
  })

  it('offers no text with texting off, as the panel page does', async () => {
    smsFlag.enabled = false
    const text = step({ id: 's-text', channel: 'text', targetSize: 3_150 })
    api.mock('GET /v1/contacts/civic-panel/plan', {
      status: 200,
      data: planWith(text, 'Invite residents by text'),
    })
    render(<CivicPanelNextStepCard />)

    expect(
      await screen.findByText("Texting isn't set up for your office yet."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start the text' }),
    ).not.toBeInTheDocument()
  })
})
