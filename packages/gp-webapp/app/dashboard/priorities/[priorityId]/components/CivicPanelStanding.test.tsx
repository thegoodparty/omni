import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type {
  ManagedCivicPanel,
  ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CivicPanelStanding } from './CivicPanelStanding'

vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test', district: null }),
}))

const panel = (
  status: ManagedCivicPanelStatus,
  members: number,
): ManagedCivicPanel => ({
  id: 'mp-1',
  status,
  inviteMessage: 'Hi.',
  consentVersion: 'v1',
  approvedAt: new Date('2026-10-29T18:00:00Z'),
  approvedByUserId: 1,
  goalMembers: 240,
  freeTextCap: 15000,
  freeTextsUsed: 120,
  readyAt: null,
  pausedAt: null,
  stoppedAt: null,
  createdAt: new Date('2026-10-29T18:00:00Z'),
  updatedAt: new Date('2026-10-29T18:00:00Z'),
  progress: {
    members,
    goalMembers: 240,
    wavesSent: 1,
    nextWaveAt: null,
    firstSendDate: '2026-11-03',
    readyWeekOf: '2026-11-16',
  },
})

const mockPanel = (value: ManagedCivicPanel | null) =>
  api.mock('GET /v1/contacts/civic-panel/managed', () => ({
    status: 200,
    data: { panel: value },
  }))

beforeEach(() => {
  testQueryClient.clear()
})

describe('CivicPanelStanding', () => {
  it('shows a building civic panel filling, linked to its page', async () => {
    mockPanel(panel('building', 82))
    render(<CivicPanelStanding />)
    const link = await screen.findByTestId('priority-civic-panel')
    expect(link).toHaveAttribute('href', '/dashboard/contacts/citizens-panel')
    expect(link).toHaveTextContent('Your civic panel is filling up')
    expect(link).toHaveTextContent('82 of 240 residents have joined')
  })

  it('says a ready civic panel is ready', async () => {
    mockPanel(panel('ready', 240))
    render(<CivicPanelStanding />)
    expect(await screen.findByTestId('priority-civic-panel')).toHaveTextContent(
      'Your civic panel is ready',
    )
  })

  it.each([
    ['none set up', null],
    ['stopped', panel('stopped', 82)],
  ])('shows nothing with %s', async (_, value) => {
    mockPanel(value)
    render(<CivicPanelStanding />)
    await waitFor(() => expect(testQueryClient.isFetching()).toBe(0))
    expect(screen.queryByTestId('priority-civic-panel')).toBeNull()
  })
})
