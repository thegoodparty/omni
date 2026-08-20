import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { ChannelTileGrid } from './ChannelTileGrid'

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

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 9, isPro: true }, vi.fn()],
}))

const socialFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2SocialFlag', () => ({
  useVoterOutreachV2SocialFlag: () => socialFlag,
}))

describe('ChannelTileGrid — social tile swap flag', () => {
  beforeEach(() => {
    socialFlag.ready = true
    socialFlag.enabled = true
  })

  it('opens the new social flow when the flag is on', async () => {
    const onCreateSocial = vi.fn()
    render(<ChannelTileGrid onCreateSocial={onCreateSocial} />)

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('launches the legacy socialMedia TaskFlow when the flag is off', async () => {
    socialFlag.enabled = false
    const onCreateSocial = vi.fn()
    render(<ChannelTileGrid onCreateSocial={onCreateSocial} />)

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('socialMedia')
  })

  it('treats an unsettled flag as off (legacy launch, no flash)', async () => {
    socialFlag.ready = false
    const onCreateSocial = vi.fn()
    render(<ChannelTileGrid onCreateSocial={onCreateSocial} />)

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-flow')).toHaveTextContent('socialMedia')
  })
})
