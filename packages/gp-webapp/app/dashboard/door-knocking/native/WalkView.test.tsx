import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import WalkView from './WalkView'

const routePayload: DoorKnockingRoutePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 3,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 2400,
    stopCount: 2,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [
    // Served out of order on purpose: the view must sort by seq.
    {
      id: 12,
      seq: 2,
      lat: 36.17,
      lng: -86.77,
      displayAddress: '210 Cedar Row',
      legSeconds: 300,
      legMeters: 380,
      knockStatus: 'supporter',
      addresses: [
        {
          addressKey: '210|cedar|row',
          address: '210 Cedar Row',
          targets: [
            {
              stopTargetId: 22,
              personId: 'person-2',
              name: 'Marisol Vega',
              age: 44,
              politicalParty: 'Independent',
              knockStatus: 'supporter',
              mayHaveMoved: false,
            },
          ],
          otherResidents: [{ name: 'Ruben Vega' }],
        },
      ],
    },
    {
      id: 11,
      seq: 1,
      lat: 36.16,
      lng: -86.78,
      displayAddress: '105 Elm St',
      legSeconds: 0,
      legMeters: 0,
      knockStatus: 'unknown',
      addresses: [
        {
          addressKey: '105|elm|st',
          address: '105 Elm St',
          targets: [
            {
              stopTargetId: 21,
              personId: 'person-1',
              name: 'Dorian Fen',
              age: 31,
              politicalParty: null,
              knockStatus: 'unknown',
              mayHaveMoved: true,
            },
          ],
          otherResidents: [],
        },
      ],
    },
  ],
}

describe('WalkView', () => {
  beforeEach(() => {
    testQueryClient.clear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  it('renders stops in seq order with route totals', async () => {
    render(<WalkView turfId={3} turfName="Elm loop" onBack={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    expect(screen.getByText(/2 stops · 31 min/)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(within(items[0] as HTMLElement).getByText('105 Elm St')).toBeTruthy()
    expect(
      within(items[1] as HTMLElement).getByText('210 Cedar Row'),
    ).toBeTruthy()
  })

  it('records an answered knock and recolors from the response', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })

    render(<WalkView turfId={3} turfName="Elm loop" onBack={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    expect(
      screen.getByText('May have moved since this route was built.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(
      within(
        screen.getByText('Do they support you?').parentElement as HTMLElement,
      ).getByRole('radio', { name: 'Yes' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      stopTargetId: 21,
      outcome: 'answered',
      supportAnswer: 'supporter',
    })
    expect((posted[0] as { clientKey: string }).clientKey).toMatch(
      /[0-9a-f-]{36}/,
    )
    expect(posted[0]).not.toHaveProperty('willVote')

    const elmStop = screen.getAllByRole('listitem')[0] as HTMLElement
    await waitFor(() =>
      expect(within(elmStop).getAllByText('Supporter').length).toBeGreaterThan(
        0,
      ),
    )
  })

  it('replays the same clientKey when the form is closed and reopened', async () => {
    const keys: string[] = []
    let failFirst = true
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      keys.push((body as { clientKey: string }).clientKey)
      if (failFirst) {
        failFirst = false
        return { status: 500, data: {} }
      }
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkView turfId={3} turfName="Elm loop" onBack={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(1))

    // Close and reopen the form — the remount must not mint a new key,
    // or the server-side upsert can't dedupe the retry.
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).toBe(keys[0])
  })

  it('mints a fresh clientKey for the next knock after a success', async () => {
    const keys: string[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      keys.push((body as { clientKey: string }).clientKey)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkView turfId={3} turfName="Elm loop" onBack={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(1))

    // A confirmed save retires the key: a later, genuinely new knock on the
    // same person must NOT replay it, or the upsert would overwrite the
    // first interaction instead of recording a second one.
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).not.toBe(keys[0])
  })

  it('never sends answers with a non-answered outcome', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkView turfId={3} turfName="Elm loop" onBack={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    // Pick answers first, then flip to Not home — the answers must not leak.
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(
      within(
        screen.getByText('Will they vote?').parentElement as HTMLElement,
      ).getByRole('radio', { name: 'Yes' }),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ outcome: 'not_home' })
    expect(posted[0]).not.toHaveProperty('supportAnswer')
    expect(posted[0]).not.toHaveProperty('willVote')
  })
})
