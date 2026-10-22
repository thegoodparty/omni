import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServeOfficePicker from './ServeOfficePicker'
import { clientFetch } from 'gpApi/clientFetch'

vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

const mockClientFetch = vi.mocked(clientFetch)

const ward1 = (
  brPositionId: string,
  positionId: string,
  electionDay: string,
  extra: { isPrimary?: boolean; isRunoff?: boolean } = {},
) => ({
  id: `${brPositionId}-${electionDay}`,
  brPositionId,
  position: {
    id: positionId,
    name: 'City Council - Ward 1',
    level: 'City',
    state: 'WY',
  },
  election: { electionDay },
  isPrimary: extra.isPrimary ?? false,
  isRunoff: extra.isRunoff ?? false,
})

const renderPicker = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ServeOfficePicker
        zip="82001"
        selected={undefined}
        onZipChange={vi.fn()}
        onSelect={vi.fn()}
        onCantFindOffice={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

type FetchResult = Awaited<ReturnType<typeof clientFetch>>

// Answers the picker's single unbounded lookup with upcoming and past races.
const mockRaces = ({
  upcoming,
  past = [],
}: {
  upcoming: ReturnType<typeof ward1>[]
  past?: ReturnType<typeof ward1>[]
}) => {
  mockClientFetch.mockResolvedValue({
    ok: true,
    data: [...upcoming, ...past],
  } as unknown as FetchResult)
}

describe('ServeOfficePicker', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
  })

  it('shows both cohort twins, each with its last general election', async () => {
    mockRaces({
      upcoming: [
        ward1('brA', 'pA', '2026-11-03'),
        ward1('brB', 'pB', '2028-11-07'),
      ],
      past: [
        // Cohort A: a later primary is not when they were elected.
        ward1('brA', 'pA', '2022-11-08'),
        ward1('brA', 'pA', '2026-03-03', { isPrimary: true }),
        // Cohort B: a later runoff is ignored too.
        ward1('brB', 'pB', '2024-11-05'),
        ward1('brB', 'pB', '2024-12-10', { isRunoff: true }),
      ],
    })

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(2)
    expect(
      screen.getByText('City · Last elected: Nov 8, 2022'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('City · Last elected: Nov 5, 2024'),
    ).toBeInTheDocument()
  })

  it('requests all races (no date bound) for the submitted zip', async () => {
    mockRaces({ upcoming: [] })

    renderPicker()

    await waitFor(() => expect(mockClientFetch).toHaveBeenCalledTimes(1))
    expect(mockClientFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ zipcode: '82001', timeframe: 'all' }),
      expect.anything(),
    )
  })

  it('lists an office whose only races are in the past, with its last elected date', async () => {
    mockRaces({ upcoming: [], past: [ward1('brD', 'pD', '2024-11-05')] })

    renderPicker()

    expect(
      await screen.findByText('City · Last elected: Nov 5, 2024'),
    ).toBeInTheDocument()
  })

  it('shows an office with no past election on file without a date', async () => {
    mockRaces({ upcoming: [ward1('brC', 'pC', '2999-11-05')] })

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(1)
    expect(screen.queryByText(/Last elected:/)).not.toBeInTheDocument()
  })
})
