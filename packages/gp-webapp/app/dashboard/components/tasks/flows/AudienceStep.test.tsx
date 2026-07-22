import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { act, screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import AudienceStep from './AudienceStep'
import type { AudienceFiltersState } from 'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters'

const mockCountVoterFile = vi.fn()
const mockClientRequest = vi.fn()

vi.mock('app/dashboard/components/tasks/flows/RecordCount', () => ({
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
  'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters',
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
      42,
    )
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: 'phone-token',
    })
  })

  it('sends no voterFileFilterId when building a new audience from checkboxes', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })
    mockCountVoterFile.mockResolvedValue(150)

    const onCreateVoterFileFilter = vi
      .fn()
      .mockResolvedValue({ id: 999, audienceSuperVoters: true })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')
    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="text"
        audience={{ audience_superVoters: true }}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={onCreateVoterFileFilter}
        onCreatePhoneList={onCreatePhoneList}
      />,
    )

    await waitFor(() => expect(screen.getByText('150')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).toHaveBeenCalled()
    expect(onCreatePhoneList).toHaveBeenCalledWith(
      expect.objectContaining({ id: 999 }),
      undefined,
    )
  })

  it('applies preselectedListId once the matching saved list loads', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        { id: 42, name: 'My Super Voters' },
        { id: 43, name: 'Other List' },
      ],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={42}
      />,
    )

    expect(await screen.findByText(/Using your saved list/)).toBeInTheDocument()
    // Appears both in the select trigger's value and the "Using your saved
    // list:" sentence below it.
    expect(screen.getAllByText('My Super Voters')).toHaveLength(2)
  })

  it('proceeding with the preselected list produces the same payload as manual selection', async () => {
    const savedList = { id: 42, name: 'My Super Voters', hasCellPhone: true }
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
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).not.toHaveBeenCalled()
    expect(onCreatePhoneList).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      42,
    )
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: 'phone-token',
    })
  })

  it('ignores an unknown preselectedListId and falls back to the default state', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 43, name: 'Other List' }],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={99999}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Using your saved list/)).not.toBeInTheDocument()
  })

  it('lets the user switch away from the preselected list without snapping back', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        { id: 42, name: 'My Super Voters' },
        { id: 43, name: 'Other List' },
      ],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Build a new audience' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(
      screen.getByRole('option', { name: 'Build a new audience' }),
    )

    await waitFor(() =>
      expect(
        screen.queryByText(/Using your saved list/),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByText(/Using your saved list/)).not.toBeInTheDocument()
  })

  it('applies a changed preselectedListId that arrives while mounted (e.g. a caller updating the id it threads down)', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        { id: 42, name: 'My Super Voters' },
        { id: 99, name: 'A Different List' },
      ],
    })

    const { rerender } = render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)
    expect(screen.getAllByText('My Super Voters')).toHaveLength(2)

    rerender(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={99}
      />,
    )

    await waitFor(() =>
      expect(screen.getAllByText('A Different List')).toHaveLength(2),
    )
    expect(screen.queryByText('My Super Voters')).not.toBeInTheDocument()
  })

  it('without preselectedListId renders identically to today (defaults to build-new)', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 42, name: 'My Super Voters' }],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Using your saved list/)).not.toBeInTheDocument()
  })

  it('a locked list (firstUsedForOutreachAt set) is still pre-selectable', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        {
          id: 42,
          name: 'Locked List',
          firstUsedForOutreachAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
        onCreatePhoneList={vi.fn().mockResolvedValue('t')}
        preselectedListId={42}
      />,
    )

    expect(await screen.findByText(/Using your saved list/)).toBeInTheDocument()
    expect(screen.getAllByText('Locked List')).toHaveLength(2)
  })

  it('hides auto-generated date-named throwaway lists', async () => {
    mockClientRequest.mockResolvedValue({
      data: [
        { id: 1, name: 'Texting outreach — Jun 24, 2026' },
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
      screen.queryByRole('option', {
        name: 'Texting outreach — Jun 24, 2026',
      }),
    ).not.toBeInTheDocument()
  })
})
