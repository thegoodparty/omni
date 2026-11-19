import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEAM_GATE_START } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import TeamPage from './TeamPage'

const { state, errorSnackbar } = vi.hoisted(() => ({
  state: {
    role: 'owner',
    flag: true,
    campaign: { createdAt: '2026-12-02T00:00:00.000Z', plan: 'free' } as {
      createdAt: string
      plan: string
      isPro?: boolean
    },
  },
  errorSnackbar: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-1' }),
  useOrganizationRole: () => state.role,
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar,
  }),
}))
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [state.campaign, vi.fn()],
}))
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: state.flag }),
}))

const PITCH_TITLE = 'Join Team to invite your campaign team'

beforeEach(() => {
  testQueryClient.clear()
  errorSnackbar.mockClear()
  state.role = 'owner'
  state.flag = true
  state.campaign = { createdAt: '2026-12-02T00:00:00.000Z', plan: 'free' }
  api.mock('GET /v1/organizations/team', {
    status: 200,
    data: { members: [], pendingInvites: [] },
  })
  api.mock('GET /v1/organizations/team/stats', {
    status: 200,
    data: { stats: [] },
  })
})

describe('TeamPage invite gate', () => {
  it('opens the Team pitch at the full price for a gated Free owner', async () => {
    const user = userEvent.setup()
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))

    expect(await screen.findByText(PITCH_TITLE)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Join Team for $399' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Who do you want to invite?')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Join Team for $399' }))
    expect(router.push).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/dashboard\/pro-upgrade\?.*plan=team.*returnTo=%2Fdashboard%2Fteam/,
      ),
    )
  })

  it('prices the pitch as the $100 difference for a Pro owner', async () => {
    const user = userEvent.setup()
    state.campaign = { ...state.campaign, plan: 'pro' }
    render(<TeamPage />)

    expect(
      await screen.findByText(/You pay the \$100 difference/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect(
      await screen.findByRole('button', { name: 'Join Team for $100' }),
    ).toBeInTheDocument()
  })

  it.each([
    [
      'a campaign created before the gate',
      { createdAt: '2026-11-30T00:00:00.000Z', plan: 'free' },
      true,
    ],
    [
      'a campaign already on Team',
      { createdAt: TEAM_GATE_START, plan: 'team' },
      true,
    ],
    ['the flag off', { createdAt: TEAM_GATE_START, plan: 'free' }, false],
  ])('opens the invite drawer for %s', async (_name, campaign, flag) => {
    const user = userEvent.setup()
    state.campaign = campaign
    state.flag = flag
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))

    expect(
      await screen.findByText('Who do you want to invite?'),
    ).toBeInTheDocument()
    expect(screen.queryByText(PITCH_TITLE)).toBeNull()
  })

  it('swaps the drawer for the Team pitch when the API answers TEAM_PLAN_REQUIRED', async () => {
    const user = userEvent.setup()
    state.flag = false
    api.mock('POST /v1/organizations/team/invites', {
      status: 403,
      data: { code: 'TEAM_PLAN_REQUIRED', message: 'Requires Team' },
    })
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Campaign Manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(await screen.findByText(PITCH_TITLE)).toBeInTheDocument()
  })

  it('tells a manager the owner must upgrade instead of opening checkout', async () => {
    const user = userEvent.setup()
    state.role = 'campaignAdmin'
    api.mock('POST /v1/organizations/team/invites', {
      status: 403,
      data: { code: 'TEAM_PLAN_REQUIRED', message: 'Requires Team' },
    })
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('radio', { name: /Campaign Manager/ }))
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Only the campaign owner can upgrade to Team.',
      ),
    )
    expect(screen.queryByText(PITCH_TITLE)).toBeNull()
  })
})
