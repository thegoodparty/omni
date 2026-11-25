import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServeOfficePicker from './ServeOfficePicker'
import { clientFetch } from 'gpApi/clientFetch'

vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
}))

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

// Answers the picker's single lookup with every race on file for the zip,
// oldest first as the API returns them.
const mockRaces = (races: ReturnType<typeof ward1>[]) => {
  mockClientFetch.mockResolvedValue({
    ok: true,
    data: races,
  } as unknown as FetchResult)
}

describe('ServeOfficePicker', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
  })

  it('asks for every race on file for the zip, with no date bound', async () => {
    mockRaces([])

    renderPicker()

    await waitFor(() => expect(mockClientFetch).toHaveBeenCalledTimes(1))
    expect(mockClientFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ zipcode: '82001', timeframe: 'all' }),
      expect.anything(),
    )
  })

  it('shows both cohort twins, each with its last general election', async () => {
    mockRaces([
      // Cohort A: a later primary is not when they were elected.
      ward1('brA', 'pA', '2021-11-02'),
      ward1('brA', 'pA', '2022-03-01', { isPrimary: true }),
      ward1('brA', 'pA', '2999-11-03'),
      // Cohort B: a later runoff is ignored too.
      ward1('brB', 'pB', '2023-11-07'),
      ward1('brB', 'pB', '2023-12-05', { isRunoff: true }),
      ward1('brB', 'pB', '2999-11-07'),
    ])

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(2)
    expect(
      screen.getByText('City · Last elected: Nov 2, 2021'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('City · Last elected: Nov 7, 2023'),
    ).toBeInTheDocument()
  })

  it('lists a seat whose only races are in the past', async () => {
    // ENG-11637: a held seat whose next election is not on file yet. The seat
    // row must come from its past races instead of dropping out.
    mockRaces([
      ward1('brWaupaca', 'pWaupaca', '2024-02-20', { isPrimary: true }),
      ward1('brWaupaca', 'pWaupaca', '2024-04-02'),
    ])

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(1)
    expect(
      screen.getByText('City · Last elected: Apr 2, 2024'),
    ).toBeInTheDocument()
  })

  it('shows an office with no past election on file without a date', async () => {
    mockRaces([ward1('brC', 'pC', '2999-11-05')])

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(1)
    expect(screen.queryByText(/Last elected:/)).not.toBeInTheDocument()
  })

  it('shows the error state when the lookup fails', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Error',
    } as unknown as FetchResult)

    renderPicker()

    expect(
      await screen.findByText(
        "We couldn't load offices for that ZIP code. Try again.",
      ),
    ).toBeInTheDocument()
  })
})
