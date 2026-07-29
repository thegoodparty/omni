import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import SaveTurfDialog from './SaveTurfDialog'
import type { PolygonRing } from './VoterMapCanvas'

// mapbox-gl-draw hands back an open ring; the dialog must close it before
// POSTing (GeoJsonPolygonSchema rejects unclosed rings).
const OPEN_RING: PolygonRing = [
  [-86.78, 36.16],
  [-86.77, 36.16],
  [-86.77, 36.17],
]

const savedTurf: DoorKnockingTurf = {
  id: 1,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon',
    coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
  },
  locked: false,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

describe('SaveTurfDialog', () => {
  beforeEach(() => {
    testQueryClient.clear()
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 7, name: 'Likely supporters' }],
    })
  })

  it('posts a closed ring with the chosen list and name', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      posted.push(body)
      return { status: 200, data: savedTurf }
    })
    const onSaved = vi.fn()

    render(
      <SaveTurfDialog
        ring={OPEN_RING}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
    )

    fireEvent.change(screen.getByLabelText('Turf name'), {
      target: { value: 'Elm St & 5th' },
    })
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Likely supporters' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Likely supporters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save turf' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(posted).toEqual([
      {
        voterFileFilterId: 7,
        name: 'Elm St & 5th',
        color: '#2563eb',
        geoPoly: {
          type: 'Polygon',
          coordinates: [
            [
              [-86.78, 36.16],
              [-86.77, 36.16],
              [-86.77, 36.17],
              [-86.78, 36.16],
            ],
          ],
        },
      },
    ])
  })

  it('keeps save disabled until a name and list are chosen', async () => {
    render(
      <SaveTurfDialog
        ring={OPEN_RING}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const save = screen.getByRole('button', { name: 'Save turf' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Turf name'), {
      target: { value: 'Elm St & 5th' },
    })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Likely supporters' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('option', { name: 'Likely supporters' }))
    expect(save).toBeEnabled()
  })
})
