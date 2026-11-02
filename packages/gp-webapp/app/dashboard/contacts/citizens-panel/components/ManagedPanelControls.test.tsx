import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const panel = (
  status: ManagedCivicPanelStatus,
  progress: Partial<ManagedCivicPanel['progress']> = {},
): ManagedCivicPanel => ({
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
  createdAt: new Date('2026-10-22T18:00:00Z'),
  updatedAt: new Date('2026-10-22T18:00:00Z'),
  progress: {
    members: 12,
    goalMembers: 250,
    wavesSent: 1,
    nextWaveAt: new Date(2026, 10, 3),
    firstSendDate: '2026-10-27',
    readyWeekOf: '2026-11-09',
    ...progress,
  },
})

const mockPatch = () => {
  const actions: string[] = []
  api.mock('PATCH /v1/contacts/civic-panel/managed', ({ body }) => {
    actions.push(body.action)
    const next = body.action === 'pause' ? 'paused' : 'building'
    return { status: 200, data: { panel: panel(next) } }
  })
  return actions
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 23), toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ManagedPanelControls', () => {
  it('says when the next invites go out and when the panel should be ready', () => {
    render(<ManagedPanelControls panel={panel('building')} />)

    expect(screen.getByRole('heading', { name: 'Invites' })).toBeInTheDocument()
    expect(
      screen.getByText("We're sending invites in your name."),
    ).toBeInTheDocument()
    expect(screen.getByText('Next invites')).toBeInTheDocument()
    expect(screen.getByText('Tue, Nov 3')).toBeInTheDocument()
    expect(screen.getByText('Ready around')).toBeInTheDocument()
    expect(screen.getByText('Week of Nov 9')).toBeInTheDocument()
  })

  it('names the first send day before any wave has gone', () => {
    render(
      <ManagedPanelControls
        panel={panel('building', { wavesSent: 0, nextWaveAt: null })}
      />,
    )

    expect(screen.getByText('Tue, Oct 27')).toBeInTheDocument()
  })

  it('drops a ready week that has passed', () => {
    vi.setSystemTime(new Date(2026, 10, 20))
    render(<ManagedPanelControls panel={panel('building')} />)

    expect(screen.queryByText('Ready around')).toBeNull()
  })

  it('pauses a building panel through the PATCH route', async () => {
    const user = userEvent.setup()
    const actions = mockPatch()
    render(<ManagedPanelControls panel={panel('building')} />)

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
    expect(screen.queryByText('Next invites')).toBeNull()
  })

  it('offers only Pause invites while building', () => {
    render(<ManagedPanelControls panel={panel('building')} />)

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Pause invites',
    ])
  })

  it('resumes a paused panel through the PATCH route, with no other button', async () => {
    const user = userEvent.setup()
    const actions = mockPatch()
    render(<ManagedPanelControls panel={panel('paused')} />)

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Resume invites',
    ])
    await user.click(screen.getByRole('button', { name: 'Resume invites' }))

    await waitFor(() => expect(actions).toEqual(['resume']))
    expect(
      await screen.findByText("We're sending invites in your name."),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Pause invites' }),
    ).toBeInTheDocument()
  })

  it('says a full panel sends no new invites, with no button', () => {
    render(<ManagedPanelControls panel={panel('ready')} />)

    expect(
      screen.getByText(
        'Your civic panel is full. No new invites are going out.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('redraws the card in its real state when the status moved since the page loaded', async () => {
    const user = userEvent.setup()
    api.mock('PATCH /v1/contacts/civic-panel/managed', () => ({
      status: 409,
      data: { message: "A ready civic panel can't resume" },
    }))
    api.mock('GET /v1/contacts/civic-panel/managed', () => ({
      status: 200,
      data: { panel: panel('ready') },
    }))
    render(<ManagedPanelControls panel={panel('paused')} />)

    await user.click(screen.getByRole('button', { name: 'Resume invites' }))

    expect(
      await screen.findByText(
        'Your civic panel is full. No new invites are going out.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume invites' })).toBeNull()
    expect(
      screen.queryByText("We couldn't change your civic panel. Try again."),
    ).toBeNull()
  })

  it('asks to try again when the change fails for another reason', async () => {
    const user = userEvent.setup()
    api.mock('PATCH /v1/contacts/civic-panel/managed', () => ({
      status: 500,
      data: { message: 'boom' },
    }))
    render(<ManagedPanelControls panel={panel('building')} />)

    await user.click(screen.getByRole('button', { name: 'Pause invites' }))

    expect(
      await screen.findByText(
        "We couldn't change your civic panel. Try again.",
      ),
    ).toBeInTheDocument()
  })

  it('says every resident we can text has an invite, with no link and no button', () => {
    render(<ManagedPanelControls panel={panel('exhausted')} />)

    expect(
      screen.getByText("We've invited everyone we can reach by text."),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('managed-panel-join-link')).toBeNull()
    expect(screen.queryByText(/link/i)).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('shows nothing for a stopped panel', () => {
    render(<ManagedPanelControls panel={panel('stopped')} />)

    expect(screen.queryByTestId('managed-panel-controls')).toBeNull()
  })
})
