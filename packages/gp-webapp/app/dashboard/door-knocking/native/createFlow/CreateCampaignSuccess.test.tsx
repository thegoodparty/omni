import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import { CreateCampaignSuccess } from './CreateCampaignSuccess'

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-1' }),
}))

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const TURF: DoorKnockingTurf = {
  id: 12,
  outreachId: 30,
  voterFileFilterId: 4,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: { type: 'Polygon', coordinates: [] },
  stopCount: 3,
  doorCount: 4,
  knockedDoorCount: 0,
  peopleCount: 9,
  loggedCount: 0,
  routeSeconds: null,
  priorityId: null,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
}

const renderSuccess = (isServe: boolean) =>
  render(
    <CreateCampaignSuccess
      isServe={isServe}
      campaignName="West End walk"
      turfs={[TURF]}
      anchorOutreachId={30}
      onStartKnocking={vi.fn()}
      onTurfCompleted={vi.fn()}
      onDone={vi.fn()}
    />,
  )

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
  vi.mocked(useIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: false,
  })
  api.mock('GET /v1/organizations/team', {
    status: 200,
    data: { members: [], pendingInvites: [] },
  })
})

describe('CreateCampaignSuccess wording', () => {
  it('tells a candidate their campaign is ready', () => {
    renderSuccess(false)

    expect(
      screen.getByRole('heading', { name: 'Your campaign is ready' }),
    ).toBeInTheDocument()
  })

  // An official reading "Your campaign is ready" bare reads about a run for
  // office. Named by its channel, it is the outreach they just built.
  it('names the channel for an elected official', () => {
    const { container } = renderSuccess(true)

    expect(
      screen.getByRole('heading', {
        name: 'Your door knocking campaign is ready',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('West End walk')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(
      /\b(?:voters?|elections?|candidates?|ballots?)\b/i,
    )
  })
})
