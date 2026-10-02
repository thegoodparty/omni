import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type {
  DoorKnockingTurf,
  PendingFeedback,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import { useWinIssueCaptureFlag } from 'app/shared/experiments/winIssueCaptureFlag'
import VolunteerWalkPage from './VolunteerWalkPage'

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

vi.mock('app/shared/experiments/serveIssueCaptureFlag', () => ({
  useServeIssueCaptureFlag: vi.fn(),
}))

vi.mock('app/shared/experiments/winIssueCaptureFlag', () => ({
  useWinIssueCaptureFlag: vi.fn(),
}))

// deck.gl and maplibre don't run in jsdom.
vi.mock('app/dashboard/door-knocking/native/VoterMapCanvas', () => ({
  __esModule: true,
  default: () => <div data-testid="voter-map" />,
}))

const OUTREACH_ID = 900

const turf: DoorKnockingTurf = {
  id: 7,
  outreachId: OUTREACH_ID,
  voterFileFilterId: 3,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: { type: 'Polygon', coordinates: [] },
  stopCount: 1,
  doorCount: 1,
  peopleCount: 1,
  loggedCount: 0,
  knockedDoorCount: 0,
  routeSeconds: 600,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const routePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 7,
    mode: 'walk' as const,
    loop: false,
    totalSeconds: 600,
    totalMeters: 800,
    stopCount: 0,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [],
}

const pendingMemo: PendingFeedback = {
  id: 'memo-1',
  personId: 'person-1',
  occurredAt: new Date('2026-10-01T00:00:00Z'),
  channel: 'door_knock',
  transcript: null,
  issues: [],
  extractionStatus: 'pending',
  confirmedAt: null,
  outreachId: OUTREACH_ID,
  actorName: 'Val Unteer',
  tags: [],
  clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
  reference: null,
}

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  })
  vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: false,
  })
  vi.mocked(useWinIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: true,
  })
  api.mock('GET /v1/door-knocking/turfs/:id', { status: 200, data: turf })
  api.mock('GET /v1/door-knocking/turfs/:id/route', {
    status: 200,
    data: routePayload,
  })
})

// A volunteer's own notes waiting for review are a tap away from the walk,
// on the volunteer's side of the app, not the manager's.
describe('VolunteerWalkPage: notes to review', () => {
  it('shows the volunteer their waiting notes and links to them', async () => {
    let askedFor: string | undefined
    api.mock('GET /v1/constituent-feedback/pending', ({ query }) => {
      askedFor = String(query.outreachId)
      return { status: 200, data: { feedback: [pendingMemo] } }
    })

    render(<VolunteerWalkPage turfId={7} />)

    const link = await screen.findByRole('link', {
      name: /Notes to review: 1/,
    })
    expect(link).toHaveAttribute('href', '/volunteer/door-knocking/7/review')
    expect(askedFor).toBe(String(OUTREACH_ID))
  })

  it('shows nothing when no note is waiting', async () => {
    api.mock('GET /v1/constituent-feedback/pending', {
      status: 200,
      data: { feedback: [] },
    })

    render(<VolunteerWalkPage turfId={7} />)

    await screen.findByText('Elm St & 5th')
    expect(screen.queryByRole('link', { name: /Notes to review/ })).toBeNull()
  })
})
