import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import NativeDoorKnockingPage from './NativeDoorKnockingPage'

// 4 people over 2 dots. Person 0 is a supporter and persons 1-2 are unknown,
// all three at dot 0; person 3 is unknown at dot 1, outside the saved turf
// below. So the district reads 3 unknown / 1 supporter and the turf reads
// 2 unknown / 1 supporter — the two numbers the rail has to tell apart.
const { packFixture } = vi.hoisted(() => ({
  packFixture: {
    manifest: {
      version: 1,
      generatedAt: '2026-07-21T12:00:00Z',
      counts: { people: 4, households: 3, dots: 2 },
      dims: [
        { key: 'canvassStatus', values: ['unknown', 'not_home', 'supporter'] },
      ],
      arrays: [],
    },
    positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
    personToHousehold: new Uint32Array([0, 0, 1, 2]),
    householdToDot: new Uint32Array([0, 0, 1]),
    dimPlanes: new Map([['canvassStatus', new Uint8Array([2, 0, 0, 0])]]),
  },
}))

vi.mock('./useVoterPack', () => ({
  voterPackQueryOptions: {
    queryKey: ['door-knocking-pack'],
    queryFn: async () => packFixture,
  },
}))
// deck.gl and maplibre don't run in jsdom. The stub reports the filtered
// people count so a chip click can be checked against the map, not just
// against the rail's own copy.
vi.mock('./VoterMapCanvas', () => ({
  __esModule: true,
  default: ({ filterResult }: { filterResult: { people: number } }) => (
    <div data-testid="voter-map" data-people={String(filterResult.people)} />
  ),
}))
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('app/dashboard/shared/useDistrictResolution', () => ({
  useDistrictResolution: () => ({ isUnresolvable: false }),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => null,
}))
vi.mock('./useWalkSession', () => ({
  useWalkSession: () => ({
    turf: null,
    start: vi.fn(),
    end: vi.fn(),
    recordDoor: vi.fn(),
  }),
}))

// A ring around dot 0 only, so person 3 falls outside the list.
const turf: DoorKnockingTurf = {
  id: 1,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon',
    coordinates: [
      [
        [-87.655, 41.895],
        [-87.645, 41.895],
        [-87.645, 41.905],
        [-87.655, 41.905],
        [-87.655, 41.895],
      ],
    ],
  },
  locked: false,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
}

const chip = (label: string, count: number) =>
  screen.getByRole('button', { name: new RegExp(`${label}\\s*${count}`) })

const renderPage = () => {
  api.mock('GET /v1/door-knocking/turfs', { status: 200, data: [turf] })
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
  return render(
    <NativeDoorKnockingPage
      pathname="/dashboard/door-knocking"
      campaign={null}
    />,
  )
}

const selectTurf = async () => {
  await waitFor(() =>
    expect(screen.getByText('Elm St & 5th')).toBeInTheDocument(),
  )
  fireEvent.click(screen.getByText('Elm St & 5th'))
  await waitFor(() =>
    expect(screen.getByText(/voters in this list/)).toBeInTheDocument(),
  )
}

describe('NativeDoorKnockingPage landing rail', () => {
  beforeEach(() => {
    testQueryClient.clear()
  })

  it('counts the whole district before a list is selected', async () => {
    renderPage()

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(
      screen.getByRole('heading', { name: 'District voters' }),
    ).toBeInTheDocument()
    expect(chip('Support unknown', 3)).toBeInTheDocument()
    expect(chip('Supporter', 1)).toBeInTheDocument()
  })

  // The regression: the heading and the line under it rescoped to the selected
  // turf while the seven legend counts stayed district-wide, so the numbers
  // described a different audience than the heading above them named.
  it('rescopes the legend counts to the selected list', async () => {
    renderPage()
    await selectTurf()

    expect(
      screen.getByRole('heading', { name: 'Elm St & 5th' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/3\s*voters in this list/)).toBeInTheDocument()

    // Person 3 is an unknown outside the ring: 3 district-wide, 2 in the list.
    expect(chip('Support unknown', 2)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Support unknown\s*3/ }),
    ).toBeNull()
    expect(chip('Supporter', 1)).toBeInTheDocument()
  })

  // The chips were pressed-but-inert with a list selected: the turf branch of
  // `selections` returned before statusFilter was ever read, so aria-pressed
  // flipped and the map stayed exactly as it was.
  it('filters within the selected list when a status chip is clicked', async () => {
    renderPage()
    await selectTurf()

    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '3')

    fireEvent.click(chip('Support unknown', 2))

    // 2, not 3: the chip narrows inside the list rather than replacing its
    // scope with a district-wide status filter.
    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '2')
    expect(chip('Support unknown', 2)).toHaveAttribute('aria-pressed', 'true')
  })

  // Leaving a scope has to drop the chip too. Carried across the boundary it
  // would silently re-narrow the district to whatever status was pressed
  // inside the list, under a heading that has gone back to naming everything.
  it('returns to an unfiltered district on Show all', async () => {
    renderPage()
    await selectTurf()

    fireEvent.click(chip('Support unknown', 2))
    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))

    const line = await screen.findByText(
      /voters in your district with a mapped address/,
    )
    expect(line).toHaveTextContent(
      '4 voters in your district with a mapped address',
    )
    expect(screen.getByTestId('voter-map')).toHaveAttribute('data-people', '4')
    expect(chip('Support unknown', 3)).toHaveAttribute('aria-pressed', 'false')
  })

  // A legend that narrowed with its own chip would zero the other six counts
  // and leave nothing to press back.
  it('keeps the legend counts describing the list, not the pressed chip', async () => {
    renderPage()
    await selectTurf()

    fireEvent.click(chip('Support unknown', 2))

    await waitFor(() =>
      expect(screen.getByText(/2\s*voters in this list/)).toBeInTheDocument(),
    )
    expect(chip('Supporter', 1)).toBeInTheDocument()
    expect(chip('Support unknown', 2)).toBeInTheDocument()
  })
})
