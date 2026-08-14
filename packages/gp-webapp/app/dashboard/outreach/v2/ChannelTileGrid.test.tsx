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
  default: ({ type }: { type: string }) => (
    <div data-testid="task-flow">{type}</div>
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

const socialFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2SocialFlag', () => ({
  useVoterOutreachV2SocialFlag: () => socialFlag,
}))

const robocallFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2RobocallFlag', () => ({
  useVoterOutreachV2RobocallFlag: () => robocallFlag,
}))

const phoneBankingFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2PhoneBankingFlag', () => ({
  useVoterOutreachV2PhoneBankingFlag: () => phoneBankingFlag,
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
  }> = {},
) =>
  render(
    <ChannelTileGrid
      onCreateSocial={overrides.onCreateSocial ?? vi.fn()}
      onCreateSms={overrides.onCreateSms ?? vi.fn()}
      onCreateRobocall={overrides.onCreateRobocall ?? vi.fn()}
      onCreatePhoneBanking={overrides.onCreatePhoneBanking ?? vi.fn()}
    />,
  )

describe('ChannelTileGrid — social tile swap flag', () => {
  beforeEach(() => {
    socialFlag.ready = true
    socialFlag.enabled = true
  })

  it('opens the new social flow when the flag is on', async () => {
    const onCreateSocial = vi.fn()
    renderGrid({ onCreateSocial })

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('launches the legacy socialMedia TaskFlow when the flag is off', async () => {
    socialFlag.enabled = false
    const onCreateSocial = vi.fn()
    renderGrid({ onCreateSocial })

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('socialMedia')
  })

  it('treats an unsettled flag as off (legacy launch, no flash)', async () => {
    socialFlag.ready = false
    const onCreateSocial = vi.fn()
    renderGrid({ onCreateSocial })

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('socialMedia')
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

// ENG-10920: tile handler matrix — (flag on/off) x (pro / non-pro /
// electedOffice / pending) asserting open vs redirect vs legacy.
describe('ChannelTileGrid — phone-banking tile swap flag + Pro redirect', () => {
  beforeEach(() => {
    phoneBankingFlag.ready = true
    phoneBankingFlag.enabled = true
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
  })

  it('flag on + Pro campaign: opens the new PhoneBankingFlow', async () => {
    mockCampaign = { id: 9, isPro: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('flag on + non-Pro campaign: redirects to pro-upgrade, no modal, no flow flash', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('flag on + elected official (no Pro sub): opens the flow', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('flag on + elected official (no Pro sub): tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAttribute('data-locked')
  })

  it('flag on + non-Pro + pending elected-office state: tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAttribute('data-locked')
  })

  it('flag on + non-Pro, no elected office: tile is visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    renderGrid()

    expect(screen.getByText('Phone banking').closest('button')).toHaveAttribute(
      'data-locked',
    )
  })

  it('flag on + non-Pro + pending elected-office state: does not redirect', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
  })

  it('flag off: legacy TaskFlow + Pro modal behavior, unchanged', async () => {
    phoneBankingFlag.enabled = false
    mockCampaign = { id: 9, isPro: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Get Pro voter data and tools'),
    ).toBeInTheDocument()
  })

  it('flag off + elected official + non-Pro: tile stays locked and click shows the legacy Pro modal (byte-identical legacy behavior)', async () => {
    phoneBankingFlag.enabled = false
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    expect(screen.getByText('Phone banking').closest('button')).toHaveAttribute(
      'data-locked',
    )

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
    expect(
      await screen.findByText('Get Pro voter data and tools'),
    ).toBeInTheDocument()
  })

  it('flag unsettled: legacy TaskFlow behavior, unchanged', async () => {
    phoneBankingFlag.ready = false
    mockCampaign = { id: 9, isPro: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('phoneBanking')
  })
})
