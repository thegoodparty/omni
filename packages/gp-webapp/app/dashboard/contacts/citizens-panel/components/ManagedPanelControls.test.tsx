import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  ManagedCivicPanel,
  ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { ManagedPanelControls } from './ManagedPanelControls'

vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test', district: null }),
}))

const panel = (status: ManagedCivicPanelStatus): ManagedCivicPanel => ({
  id: 'mp-1',
  status,
  inviteMessage: 'Hi.',
  consentVersion: 'v1',
  approvedAt: new Date('2026-10-22T18:00:00Z'),
  approvedByUserId: 1,
  goalMembers: 250,
  freeTextCap: 15000,
  freeTextsUsed: 120,
  readyAt: null,
  pausedAt: null,
  stoppedAt: null,
  shareCode: 'a1b2c3d4e5f6',
  createdAt: new Date('2026-10-22T18:00:00Z'),
  updatedAt: new Date('2026-10-22T18:00:00Z'),
  progress: {
    members: 12,
    goalMembers: 250,
    wavesSent: 1,
    nextWaveAt: new Date(2026, 10, 3),
  },
})

const mockPatch = () => {
  const actions: string[] = []
  api.mock('PATCH /v1/contacts/civic-panel/managed', ({ body }) => {
    actions.push(body.action)
    const next =
      body.action === 'pause'
        ? 'paused'
        : body.action === 'resume'
          ? 'building'
          : 'stopped'
    return { status: 200, data: { panel: panel(next) } }
  })
  return actions
}

describe('ManagedPanelControls', () => {
  it('pauses a building panel through the PATCH route', async () => {
    const user = userEvent.setup()
    const actions = mockPatch()
    render(<ManagedPanelControls panel={panel('building')} />)

    expect(
      screen.getByText(
        "We're sending invites. The next ones go out Tuesday, November 3.",
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause invites' }))

    await waitFor(() => expect(actions).toEqual(['pause']))
    expect(
      await screen.findByText(
        'Invites are paused. Nobody new gets one until you resume.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Resume invites' }),
    ).toBeInTheDocument()
  })

  it('stops the panel only once the official confirms', async () => {
    const user = userEvent.setup()
    const actions = mockPatch()
    render(<ManagedPanelControls panel={panel('paused')} />)

    await user.click(
      screen.getByRole('button', { name: 'Stop my civic panel' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Stop building your civic panel?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep building' }))
    expect(actions).toEqual([])

    await user.click(
      screen.getByRole('button', { name: 'Stop my civic panel' }),
    )
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Stop my civic panel',
    })
    await user.click(dialogButtons[dialogButtons.length - 1] as HTMLElement)

    await waitFor(() => expect(actions).toEqual(['stop']))
    await waitFor(() =>
      expect(screen.queryByTestId('managed-panel-controls')).toBeNull(),
    )
  })

  it('offers the join link once invites run out, with no pause', () => {
    render(<ManagedPanelControls panel={panel('exhausted')} />)

    expect(
      screen.getByText(
        'Everyone we can text has an invite. Share your join link to reach more residents.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/\/civic-panel\/a1b2c3d4e5f6$/)).toBeInTheDocument()
    expect(screen.getByText('Needs more residents, 12 of 250 members'))
    expect(screen.queryByRole('button', { name: 'Pause invites' })).toBeNull()
  })

  it('shows nothing for a stopped panel', () => {
    render(<ManagedPanelControls panel={panel('stopped')} />)

    expect(screen.queryByTestId('managed-panel-controls')).toBeNull()
  })
})
