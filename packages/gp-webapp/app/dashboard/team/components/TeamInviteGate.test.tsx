import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InviteBlockReason } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import TeamPage from './TeamPage'

const { state, errorSnackbar } = vi.hoisted(() => ({
  state: {
    flagOn: false,
    role: 'owner',
    plan: 'free',
    invites: { allowed: false, reason: 'TEAM_PLAN_REQUIRED' } as {
      allowed: boolean
      reason: InviteBlockReason | null
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
vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: state.flagOn }),
}))
vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ plan: state.plan }),
}))

const PITCH_TITLE = 'Join Team to invite your campaign team'

const mockTeam = () =>
  api.mock('GET /v1/organizations/team', {
    status: 200,
    data: { members: [], pendingInvites: [], invites: state.invites },
  })

beforeEach(() => {
  testQueryClient.clear()
  errorSnackbar.mockClear()
  state.flagOn = false
  state.role = 'owner'
  state.plan = 'free'
  state.invites = { allowed: false, reason: 'TEAM_PLAN_REQUIRED' }
  mockTeam()
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
    state.plan = 'pro'
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))

    expect(
      await screen.findByRole('button', { name: 'Join Team for $100' }),
    ).toBeInTheDocument()
  })

  describe('with win_per_campaign_pricing on (ENG-11764)', () => {
    const TITLE = 'Upgrade to invite your campaign team'

    beforeEach(() => {
      state.flagOn = true
    })

    it('opens the Team pitch from Free: gate layout, Bonus row, verification, no plans link', async () => {
      const user = userEvent.setup()
      render(<TeamPage />)

      await user.click(await screen.findByRole('button', { name: 'Invite' }))

      expect(await screen.findByText(TITLE)).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'TEAM' })).toBeInTheDocument()
      expect(
        screen.getByText('Bring your campaign manager and volunteers in'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Pay $399 once for your plan, good for your whole race',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Voter data, texts and robocalls to reach voters'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('$175 outreach credit to get started'),
      ).toBeInTheDocument()
      expect(screen.getByText('Bonus')).toBeInTheDocument()
      expect(
        screen.getByText('Campaign verification included'),
      ).toBeInTheDocument()
      expect(screen.queryByText('See all plans')).toBeNull()

      await user.click(
        screen.getByRole('button', { name: 'Join Team for $399' }),
      )
      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/dashboard\/pro-upgrade\?.*plan=team.*returnTo=%2Fdashboard%2Fteam/,
        ),
      )
    })

    it('opens the Team cross-sell from Pro with only the two logins, and no info box', async () => {
      const user = userEvent.setup()
      state.plan = 'pro'
      render(<TeamPage />)

      expect(
        screen.queryByText('Logins for your team come with Team'),
      ).toBeNull()
      await user.click(await screen.findByRole('button', { name: 'Invite' }))

      expect(await screen.findByText(TITLE)).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'TEAM' })).toBeInTheDocument()
      expect(
        screen.getByText('Pay $100 once to upgrade, good for your whole race'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('A campaign manager login to help you share the load'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Volunteer logins to walk door-knocking turfs'),
      ).toBeInTheDocument()
      expect(screen.queryByText('Bonus')).toBeNull()
      expect(screen.queryByText(/Voter data/)).toBeNull()
      expect(screen.queryByText('Campaign verification included')).toBeNull()
      expect(screen.queryByText('See all plans')).toBeNull()

      await user.click(
        screen.getByRole('button', { name: 'Upgrade to Team for $100' }),
      )
      expect(router.push).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/dashboard\/pro-upgrade\?.*plan=team.*returnTo=%2Fdashboard%2Fteam/,
        ),
      )
    })

    it('keeps the owner-only snackbar for a gated manager', async () => {
      const user = userEvent.setup()
      state.role = 'campaignAdmin'
      render(<TeamPage />)

      await user.click(await screen.findByRole('button', { name: 'Invite' }))

      expect(errorSnackbar).toHaveBeenCalledWith(
        'Only the campaign owner can upgrade to Team.',
      )
      expect(screen.queryByText(TITLE)).toBeNull()
    })
  })

  it('opens the invite drawer when the API allows invites', async () => {
    const user = userEvent.setup()
    state.invites = { allowed: true, reason: null }
    mockTeam()
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))

    expect(
      await screen.findByText('Who do you want to invite?'),
    ).toBeInTheDocument()
    expect(screen.queryByText(PITCH_TITLE)).toBeNull()
  })

  it.each([
    ['TEST_ORGANIZATION', 'Team invites aren’t available for test accounts.'],
    [
      'ELECTED_OFFICE',
      'Team accounts aren’t available for elected offices yet.',
    ],
  ] as const)('disables Invite with a reason for %s', async (reason, copy) => {
    state.invites = { allowed: false, reason }
    mockTeam()
    render(<TeamPage />)

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled()
    expect(screen.queryByText(PITCH_TITLE)).toBeNull()
  })

  it('tells a gated manager to ask the owner without opening the drawer', async () => {
    const user = userEvent.setup()
    state.role = 'campaignAdmin'
    render(<TeamPage />)

    await user.click(await screen.findByRole('button', { name: 'Invite' }))

    expect(errorSnackbar).toHaveBeenCalledWith(
      'Only the campaign owner can upgrade to Team.',
    )
    expect(screen.queryByText('Who do you want to invite?')).toBeNull()
    expect(screen.queryByText(PITCH_TITLE)).toBeNull()
  })

  it('swaps the drawer for the Team pitch when the API answers TEAM_PLAN_REQUIRED', async () => {
    const user = userEvent.setup()
    state.invites = { allowed: true, reason: null }
    mockTeam()
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
    state.invites = { allowed: true, reason: null }
    mockTeam()
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
