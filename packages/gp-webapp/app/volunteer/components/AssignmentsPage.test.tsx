import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { MyAssignment } from '@goodparty_org/contracts'
import AssignmentsPage from './AssignmentsPage'

const { mockUseOrganization } = vi.hoisted(() => ({
  mockUseOrganization: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockUseOrganization(),
}))

const phoneBankingAssignment: MyAssignment = {
  outreachId: 1,
  outreachType: 'nativePhoneBanking',
  name: 'Call list A',
  status: 'in_progress',
  assignedAt: new Date('2026-01-01T00:00:00.000Z'),
  phoneBanking: {
    listId: 42,
    entriesTotal: 100,
    entriesCalled: 40,
    peopleTotal: 80,
    peopleCalled: 30,
    byOutcome: {
      answered: 20,
      no_answer: 10,
      voicemail: 5,
      wrong_number: 2,
      refused: 2,
      disconnected: 1,
      hung_up: 0,
    },
    supporters: 10,
    unsure: 5,
    nonSupporters: 15,
  },
}

const doorKnockingAssignment: MyAssignment = {
  outreachId: 2,
  outreachType: 'nativeDoorKnocking',
  name: 'Turf B',
  status: 'in_progress',
  assignedAt: new Date('2026-01-02T00:00:00.000Z'),
  doorKnocking: {
    turfId: 7,
    routeId: 3,
    turfName: 'Turf B',
    doorCount: 50,
    peopleCount: 60,
    loggedCount: 20,
    completed: false,
    archivedAt: null,
  },
}

const completedAssignment: MyAssignment = {
  outreachId: 3,
  outreachType: 'nativePhoneBanking',
  name: 'Call list C',
  status: 'completed',
  assignedAt: new Date('2026-01-03T00:00:00.000Z'),
  phoneBanking: {
    listId: 43,
    entriesTotal: 50,
    entriesCalled: 50,
    peopleTotal: 40,
    peopleCalled: 40,
    byOutcome: {
      answered: 40,
      no_answer: 5,
      voicemail: 3,
      wrong_number: 1,
      refused: 1,
      disconnected: 0,
      hung_up: 0,
    },
    supporters: 20,
    unsure: 5,
    nonSupporters: 15,
  },
}

let assignments: MyAssignment[]

beforeEach(() => {
  testQueryClient.clear()
  mockUseOrganization.mockReturnValue({ slug: 'org-1' })
  assignments = [phoneBankingAssignment, doorKnockingAssignment]
  api.mock('GET /v1/outreach/assignments/mine', () => ({
    status: 200,
    data: { assignments },
  }))
})

describe('AssignmentsPage — rendering assignments', () => {
  it('renders a card per assignment with channel, name, status, progress, and a routed action', async () => {
    render(<AssignmentsPage />)

    expect(await screen.findByText('Call list A')).toBeInTheDocument()
    expect(screen.getByText('Turf B')).toBeInTheDocument()
    expect(screen.getAllByText('Phone banking').length).toBeGreaterThan(0)
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    expect(screen.getAllByText('In progress').length).toBe(2)
    expect(screen.getByText('30 of 80 people reached')).toBeInTheDocument()
    expect(screen.getByText('20 of 60 people logged')).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: 'Continue calling' }),
    ).toHaveAttribute('href', '/volunteer/phone-banking/42')
    expect(
      screen.getByRole('link', { name: 'Continue knocking' }),
    ).toHaveAttribute('href', '/volunteer/door-knocking/7')
  })

  it('renders completed assignments in a separate Completed group', async () => {
    assignments = [phoneBankingAssignment, completedAssignment]

    render(<AssignmentsPage />)

    expect(await screen.findByText('Call list A')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Call list C')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })
})

describe('AssignmentsPage — empty / loading / error triad', () => {
  it('renders the designed empty state on a 200 with no assignments', async () => {
    assignments = []

    render(<AssignmentsPage />)

    expect(await screen.findByText('No assignments yet')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders skeletons while the fetch is pending, never the empty state', () => {
    let resolveMine: (() => void) | undefined
    api.mock(
      'GET /v1/outreach/assignments/mine',
      () =>
        new Promise((resolve) => {
          resolveMine = () => resolve({ status: 200, data: { assignments } })
        }),
    )

    const { container } = render(<AssignmentsPage />)

    expect(screen.queryByText('No assignments yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Call list A')).not.toBeInTheDocument()
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0)
    // Cleanup: nothing else awaits this, so the promise can't leak between
    // tests once it's on the microtask queue.
    resolveMine?.()
  })

  it('renders an error state with retry — never the empty state — on a failed fetch', async () => {
    const user = userEvent.setup()
    api.mock('GET /v1/outreach/assignments/mine', {
      status: 500,
      data: { message: 'upstream error' },
    })

    render(<AssignmentsPage />)

    expect(
      await screen.findByText('Couldn’t load your assignments'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No assignments yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Call list A')).not.toBeInTheDocument()

    let refetched = false
    api.mock('GET /v1/outreach/assignments/mine', () => {
      refetched = true
      return { status: 200, data: { assignments: [phoneBankingAssignment] } }
    })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(refetched).toBe(true))
    expect(await screen.findByText('Call list A')).toBeInTheDocument()
  })
})
