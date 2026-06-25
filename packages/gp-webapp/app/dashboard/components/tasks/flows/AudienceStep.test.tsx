import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { act, screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import AudienceStep from './AudienceStep'
import type { AudienceFiltersState } from 'app/dashboard/voter-records/components/CustomVoterAudienceFilters'

const mockCountVoterFile = vi.fn()
const mockClientRequest = vi.fn()

vi.mock('app/dashboard/voter-records/[type]/components/RecordCount', () => ({
  countVoterFile: (...args: unknown[]) => mockCountVoterFile(...args),
}))

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, hasFreeTextsOffer: false }],
}))

vi.mock(
  'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider',
  () => ({
    useP2pUxEnabled: () => ({ p2pUxEnabled: true }),
  }),
)

vi.mock(
  'app/dashboard/voter-records/components/CustomVoterAudienceFilters',
  () => ({
    default: () => null,
    TRACKING_KEYS: { scheduleCampaign: 'scheduleCampaign' },
  }),
)

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AudienceStep voter-count race', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCountVoterFile.mockReset()
    mockClientRequest.mockReset()
    mockClientRequest.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a stale earlier response that arrives after a newer one', async () => {
    const onChangeCallback = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn())

    const callA = deferred<number>()
    const callB = deferred<number>()
    mockCountVoterFile
      .mockImplementationOnce(() => callA.promise)
      .mockImplementationOnce(() => callB.promise)

    let setAudience!: (value: AudienceFiltersState) => void
    const Wrapper = () => {
      const [audience, setState] = useState<AudienceFiltersState>({
        party_independent: true,
      })
      setAudience = setState
      return (
        <AudienceStep
          type="text"
          audience={audience}
          onChangeCallback={onChangeCallback}
          nextCallback={vi.fn()}
          backCallback={vi.fn()}
        />
      )
    }

    render(<Wrapper />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(mockCountVoterFile).toHaveBeenCalledTimes(1)

    act(() => {
      setAudience({ party_independent: true, gender_unknown: true })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(mockCountVoterFile).toHaveBeenCalledTimes(2)

    await act(async () => {
      callB.resolve(200)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('200')).toBeInTheDocument()
    expect(onChangeCallback).toHaveBeenLastCalledWith('voterCount', 200)

    await act(async () => {
      callA.resolve(500)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropping stale voter-count response'),
    )
    expect(screen.getByText('200')).toBeInTheDocument()
    const voterCountCalls = onChangeCallback.mock.calls.filter(
      ([key]) => key === 'voterCount',
    )
    expect(voterCountCalls.at(-1)).toEqual(['voterCount', 200])

    warn.mockRestore()
  })
})

describe('AudienceStep saved-list selector', () => {
  beforeEach(() => {
    mockCountVoterFile.mockReset()
    mockClientRequest.mockReset()
  })

  it('reuses the selected list id and does not POST a new filter', async () => {
    const savedList = {
      id: 42,
      name: 'My Super Voters',
      audienceSuperVoters: true,
      hasCellPhone: true,
    }
    mockClientRequest.mockResolvedValue({ data: [savedList] })

    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')
    const onChangeCallback = vi.fn()
    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={onChangeCallback}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={onCreateVoterFileFilter}
        onCreatePhoneList={onCreatePhoneList}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('combobox'))

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'My Super Voters' }),
      ).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('option', { name: 'My Super Voters' }))

    await waitFor(() =>
      expect(screen.getByText(/Using your saved list/)).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).not.toHaveBeenCalled()
    expect(onCreatePhoneList).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
    )
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: 'phone-token',
    })
  })

  it('hides auto-generated "<type> Campaign" throwaway lists', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        { id: 1, name: 'text Campaign' },
        { id: 2, name: 'My Real List' },
      ],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 1 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('combobox'))

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'My Real List' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('option', { name: 'text Campaign' }),
    ).not.toBeInTheDocument()
  })
})
