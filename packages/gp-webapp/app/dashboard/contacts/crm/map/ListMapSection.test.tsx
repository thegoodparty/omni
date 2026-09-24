import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import type { Person, SegmentResponse } from '../shared/contacts-types'
import { useContactsTable } from '../ContactsTableProvider'
import ListMapSection from './ListMapSection'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// deck.gl and maplibre don't run in jsdom. The stub reports the ring it was
// handed and whether it was handed a writer, which is the whole of what this
// surface asks of the canvas.
const TAPS: Array<[number, number]> = [
  [-85.62, 44.75],
  [-85.6, 44.75],
  [-85.61, 44.77],
]
vi.mock('./ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    people,
    contactPoints,
    drawRing,
    otherRings,
    onDrawRingChange,
  }: {
    people?: unknown[]
    contactPoints?: unknown[]
    drawRing?: Array<[number, number]>
    otherRings?: Array<Array<[number, number]>>
    onDrawRingChange?: (ring: Array<[number, number]>) => void
  }) {
    return (
      <div
        data-testid="contact-map-stub"
        data-people={(contactPoints ?? people ?? []).length}
        data-ring={JSON.stringify(drawRing ?? [])}
        data-other-rings={JSON.stringify(otherRings ?? [])}
        data-draw-enabled={String(Boolean(onDrawRingChange))}
      >
        <button type="button" onClick={() => onDrawRingChange?.(TAPS)}>
          place ring
        </button>
      </div>
    )
  },
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)
const errorSnackbar = vi.fn()
const successSnackbar = vi.fn()

const person = (id: string, lat: string, lng: string) =>
  ({
    id,
    firstName: 'Ada',
    lastName: 'Byron',
    address: { latitude: lat, longitude: lng },
  }) as unknown as Person

const segment = (overrides: Partial<SegmentResponse> = {}): SegmentResponse =>
  ({
    id: 7,
    name: 'Riverside block',
    ...overrides,
  }) as SegmentResponse

const SAVED_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[...TAPS, TAPS[0]!]],
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
  mockedUseContactsTable.mockReturnValue({
    selectPerson: vi.fn(),
    currentlySelectedPersonId: null,
    isWinContext: false,
  } as unknown as ReturnType<typeof useContactsTable>)
  api.mock('GET /v1/contacts', {
    status: 200,
    data: {
      people: [person('p1', '44.76', '-85.61')],
      pagination: {
        totalResults: 1,
        currentPage: 1,
        pageSize: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
  })
})

describe('ListMapSection — boundary CTA', () => {
  it('offers the draw CTA on an unlocked list', async () => {
    render(<ListMapSection segment={segment()} />)

    expect(
      await screen.findByRole('button', { name: /draw an area/i }),
    ).toBeInTheDocument()
  })

  it('reads as editing once the list carries a boundary, and draws it', async () => {
    render(<ListMapSection segment={segment({ geoPoly: SAVED_POLYGON })} />)

    expect(
      await screen.findByRole('button', { name: /edit area/i }),
    ).toBeInTheDocument()
    const map = screen.getByTestId('contact-map-stub')
    // Every part of a saved boundary is read-only here, so it arrives as
    // `otherRings` — `drawRing` is the part a gesture edits, and the sheet
    // edits nothing.
    expect(map).toHaveAttribute('data-other-rings', JSON.stringify([TAPS]))
    // Read-only on the sheet: the outline is shown, the handles are not.
    expect(map).toHaveAttribute('data-draw-enabled', 'false')
  })

  // A list used for outreach is locked and gp-api 409s the PUT, so the
  // affordance goes — but the geography it was cut with still has to be
  // legible, the same way the kebab keeps showing the filters.
  it('hides the CTA on a locked list while still drawing the saved outline', async () => {
    render(
      <ListMapSection
        segment={segment({
          geoPoly: SAVED_POLYGON,
          firstUsedForOutreachAt: '2026-09-01T00:00:00.000Z',
        })}
      />,
    )

    expect(await screen.findByTestId('contact-map-stub')).toHaveAttribute(
      'data-other-rings',
      JSON.stringify([TAPS]),
    )
    expect(
      screen.queryByRole('button', { name: /draw an area|edit area/i }),
    ).not.toBeInTheDocument()
  })

  it('saves the drawn boundary as a closed geoPoly', async () => {
    let sentBody: Record<string, unknown> | null = null
    api.mock('PUT /v1/voters/voter-file/filter/:id', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return { status: 200, data: { id: 7 } }
    })
    const user = userEvent.setup()
    render(<ListMapSection segment={segment()} />)

    await user.click(
      await screen.findByRole('button', { name: /draw an area/i }),
    )
    const overlay = within(screen.getByTestId('boundary-overlay'))
    await user.click(overlay.getByRole('button', { name: 'place ring' }))
    await user.click(overlay.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody).toMatchObject({ geoPoly: SAVED_POLYGON })
    await vi.waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ConstituentData.ListBoundarySaved,
        // `surface` distinguishes this from the same act performed on a map
        // inside a Chief of Staff transcript.
        { listId: 7, cleared: false, shapeCount: 1, surface: 'listDetail' },
      ),
    )
  })

  // Locked between the sheet opening and the save landing. The wizard's own
  // update treats that race as a neutral message rather than a failure, and
  // so does this.
  it('reports a raced lock with the locked-list message, not an error', async () => {
    api.mock('PUT /v1/voters/voter-file/filter/:id', {
      status: 409,
      data: { message: 'locked' },
    })
    const user = userEvent.setup()
    render(<ListMapSection segment={segment()} />)

    await user.click(
      await screen.findByRole('button', { name: /draw an area/i }),
    )
    const overlay = within(screen.getByTestId('boundary-overlay'))
    await user.click(overlay.getByRole('button', { name: 'place ring' }))
    await user.click(overlay.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(LOCKED_LIST_MESSAGE, {
        autoHideDuration: 6000,
      }),
    )
    expect(errorSnackbar).not.toHaveBeenCalledWith('Failed to update list')
  })
})
