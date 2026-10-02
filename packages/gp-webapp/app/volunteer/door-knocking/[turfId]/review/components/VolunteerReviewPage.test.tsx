import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type {
  DoorKnockingTurf,
  PendingFeedback,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import VolunteerReviewPage from './VolunteerReviewPage'

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

const theirMemo: PendingFeedback = {
  id: 'memo-1',
  personId: 'person-1',
  occurredAt: new Date('2026-10-01T00:00:00Z'),
  channel: 'door_knock',
  transcript: 'She wants the storm drain on her corner cleared.',
  issues: [
    {
      position: 0,
      issueLabel: 'Street flooding',
      stance: 'opposes',
      desiredOutcome: 'Clear the drain',
    },
  ],
  extractionStatus: 'extracted',
  confirmedAt: null,
  outreachId: OUTREACH_ID,
  actorName: 'Val Unteer',
  tags: [],
  clientKey: '6f1d7a9c-3f1e-4f0a-9f4e-2f5a6b7c8d90',
  reference: null,
}

beforeEach(() => {
  testQueryClient.clear()
  api.mock('GET /v1/door-knocking/turfs/:id', { status: 200, data: turf })
})

// The volunteer's review list: the turf's envelope from the turf read the
// walk already makes, and the same list and card the manager's page shows,
// which the API has already narrowed to this volunteer's own notes.
describe('VolunteerReviewPage', () => {
  it('renders the volunteer’s note with its card, and leads back to the walk', async () => {
    let askedFor: string | undefined
    api.mock('GET /v1/constituent-feedback/pending', ({ query }) => {
      askedFor = String(query.outreachId)
      return { status: 200, data: { feedback: [theirMemo] } }
    })

    render(<VolunteerReviewPage turfId={7} isServe={false} />)

    expect(
      await screen.findByText(
        'She wants the storm drain on her corner cleared.',
      ),
    ).toBeVisible()
    expect(screen.getByText('Is this right?')).toBeVisible()
    expect(screen.getByDisplayValue('Street flooding')).toBeVisible()
    expect(askedFor).toBe(String(OUTREACH_ID))
    expect(
      screen.getByRole('link', { name: 'Back to the walk' }),
    ).toHaveAttribute('href', '/volunteer/door-knocking/7')
  })
})
