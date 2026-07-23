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

describe('ServeOfficePicker', () => {
  beforeEach(() => {
    mockClientFetch.mockReset()
  })

  it('shows both cohort twins, each with its latest general/primary date', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      data: [
        // Cohort A: a primary + general in 2022 → latest general/primary is Nov 2022
        ward1('brA', 'pA', '2022-08-16', { isPrimary: true }),
        ward1('brA', 'pA', '2022-11-08'),
        // Cohort B: a 2024 general + a later runoff that must be ignored
        ward1('brB', 'pB', '2024-11-05'),
        ward1('brB', 'pB', '2024-12-10', { isRunoff: true }),
      ],
    } as unknown as Awaited<ReturnType<typeof clientFetch>>)

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(2)
    // The date is what disambiguates two identically-named cohort positions.
    expect(screen.getByText(/Last election:.*2022/)).toBeInTheDocument()
    // Cohort B shows its 2024 general, not the later 2024 runoff.
    expect(screen.getByText(/Last election:.*2024/)).toBeInTheDocument()
  })

  it('requests upcoming races for the submitted zip', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      data: [],
    } as unknown as Awaited<ReturnType<typeof clientFetch>>)

    renderPicker()

    await waitFor(() => expect(mockClientFetch).toHaveBeenCalled())
    expect(mockClientFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ zipcode: '82001', timeframe: 'future' }),
      expect.anything(),
    )
  })

  it('shows an office whose only election on file is upcoming, with no last-election date', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      data: [ward1('brC', 'pC', '2999-11-05')],
    } as unknown as Awaited<ReturnType<typeof clientFetch>>)

    renderPicker()

    const rows = await screen.findAllByRole('radio', { name: /Ward 1/ })
    expect(rows).toHaveLength(1)
    expect(screen.queryByText(/Last election:/)).not.toBeInTheDocument()
  })
})
