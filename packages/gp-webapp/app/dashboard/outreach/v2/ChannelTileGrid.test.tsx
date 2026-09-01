import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { ChannelTileGrid } from './ChannelTileGrid'

const mockRouterPush = vi.fn()
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/dashboard/components/tasks/flows/TaskFlow', () => ({
  default: ({
    type,
    preselectedListId,
  }: {
    type: string
    preselectedListId?: number
  }) => (
    <div
      data-testid="task-flow"
      data-preselected-list={String(preselectedListId)}
    >
      {type}
    </div>
  ),
}))

vi.mock('app/dashboard/outreach/hooks/useTextOutreachGate', () => ({
  useTextOutreachGate: () => ({ runTextGate: () => true, gateModals: null }),
}))

let mockCampaign: { id: number; isPro: boolean } = { id: 9, isPro: true }
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign, vi.fn()],
}))

let mockElectedOffice: {
  data: { id: number } | null | undefined
  isPending: boolean
} = { data: null, isPending: false }
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => mockElectedOffice,
}))

const robocallFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2RobocallFlag', () => ({
  useVoterOutreachV2RobocallFlag: () => robocallFlag,
}))

const smsFlag = { ready: true, enabled: false }
vi.mock('@shared/experiments/voterOutreachV2SmsFlag', () => ({
  useVoterOutreachV2SmsFlag: () => smsFlag,
}))

const renderGrid = (
  overrides: Partial<{
    onCreateSocial: () => void
    onCreateSms: () => void
    onCreateRobocall: () => void
    onCreatePhoneBanking: () => void
    preselectedListId: number
  }> = {},
) =>
  render(
    <ChannelTileGrid
      preselectedListId={overrides.preselectedListId}
      onCreateSocial={overrides.onCreateSocial ?? vi.fn()}
      onCreateSms={overrides.onCreateSms ?? vi.fn()}
      onCreateRobocall={overrides.onCreateRobocall ?? vi.fn()}
      onCreatePhoneBanking={overrides.onCreatePhoneBanking ?? vi.fn()}
    />,
  )

describe('ChannelTileGrid — social tile', () => {
  it('always opens the new social flow', async () => {
    const onCreateSocial = vi.fn()
    renderGrid({ onCreateSocial })

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })
})

describe('ChannelTileGrid — robocall tile swap flag', () => {
  beforeEach(() => {
    robocallFlag.ready = true
    robocallFlag.enabled = true
  })

  it('opens the new robocall flow when the flag is on', async () => {
    const onCreateRobocall = vi.fn()
    renderGrid({ onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('launches the legacy robocall TaskFlow when the flag is off', async () => {
    robocallFlag.enabled = false
    const onCreateRobocall = vi.fn()
    renderGrid({ onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('robocall')
  })

  it('treats an unsettled flag as off (legacy launch)', async () => {
    robocallFlag.ready = false
    const onCreateRobocall = vi.fn()
    renderGrid({ onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('robocall')
  })
})

// ENG-10920: tile handler matrix — pro / non-pro / electedOffice / pending
// asserting open vs redirect.
describe('ChannelTileGrid — phone-banking tile + Pro redirect', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
  })

  it('Pro campaign: opens the new PhoneBankingFlow', async () => {
    mockCampaign = { id: 9, isPro: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('non-Pro campaign: redirects to pro-upgrade, no modal, no flow flash', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('elected official (no Pro sub): opens the flow', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('elected official (no Pro sub): tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAttribute('data-locked')
  })

  it('non-Pro + pending elected-office state: tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAttribute('data-locked')
  })

  it('non-Pro, no elected office: tile is visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    renderGrid()

    expect(screen.getByText('Phone banking').closest('button')).toHaveAttribute(
      'data-locked',
    )
  })

  it('non-Pro + pending elected-office state: does not redirect', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
  })
})

// Door knocking is the one tile that navigates rather than opening a flow in
// place, so the selected list has to survive the navigation or "start a walk
// from this list" lands the candidate back on the picker they came from.
describe('ChannelTileGrid — door-knocking tile carries the selected list', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
  })

  it('carries the preselected list as ?listId=', async () => {
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?listId=42',
    )
  })

  it('navigates bare when no list is selected', async () => {
    renderGrid()

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/door-knocking')
  })

  it('still hands the list to the SMS tile when door knocking was not pressed', async () => {
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('SMS'))

    expect(screen.getByTestId('task-flow')).toHaveAttribute(
      'data-preselected-list',
      '42',
    )
  })

  // The instance can outlive the navigation in the App Router's soft-nav
  // cache, so a list handed to door knocking has to be spent on the way out
  // — otherwise a Back to this hub aims the next tile pressed at a list the
  // candidate chose for a walk.
  it('spends the list on the way out, so a later tile opens clean', async () => {
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('Door knocking'))
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?listId=42',
    )

    // SMS is the tile that always launches the legacy TaskFlow, which is the
    // one place a leftover id would show up as a real preselection.
    await userEvent.click(screen.getByText('SMS'))

    expect(screen.getByTestId('task-flow')).toHaveAttribute(
      'data-preselected-list',
      'undefined',
    )
  })

  // The tile is Pro-locked, and carrying a list must not become a way past
  // that: a non-Pro click still gets the upgrade modal and goes nowhere.
  it('shows the Pro modal instead of navigating for a non-Pro campaign', async () => {
    mockCampaign = { id: 9, isPro: false }
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(
      await screen.findByText('Get Pro voter data and tools'),
    ).toBeInTheDocument()
  })
})
