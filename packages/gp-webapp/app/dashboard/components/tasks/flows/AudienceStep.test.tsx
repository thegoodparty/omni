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
      // ENG-10767: a manual dropdown pick reports 'savedList', never
      // 'deepLink'.
      audienceSource: 'savedList',
      audienceListId: 42,
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

  it('proceeding with the preselected list produces the manual-selection payload, attributed to the deep link', async () => {
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
      // ENG-10767: the only payload difference from a manual pick — the
      // deep-linked preselect attributes the audience to the CRM link.
      audienceSource: 'deepLink',
      audienceListId: 42,
    })
  })

  it('reports customFilters after switching from the deep-linked list back to build-new (ENG-10767)', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 42, name: 'My Super Voters' }],
    })
    mockCountVoterFile.mockResolvedValue(150)

    const onChangeCallback = vi.fn()
    const nextCallback = vi.fn()

    let setAudience!: (value: AudienceFiltersState) => void
    const Wrapper = () => {
      const [audience, setState] = useState<AudienceFiltersState>({})
      setAudience = setState
      return (
        <AudienceStep
          type="text"
          audience={audience}
          onChangeCallback={onChangeCallback}
          nextCallback={nextCallback}
          backCallback={vi.fn()}
          onCreateVoterFileFilter={vi.fn().mockResolvedValue({ id: 999 })}
          onCreatePhoneList={vi.fn().mockResolvedValue('phone-token')}
          preselectedListId={42}
        />
      )
    }

    render(<Wrapper />)

    await screen.findByText(/Using your saved list/)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(
      await screen.findByRole('option', { name: 'Build a new audience' }),
    )
    act(() => {
      setAudience({ audience_superVoters: true })
    })
    await waitFor(() => expect(screen.getByText('150')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    // The consumed deep link must not leave a stale 'deepLink' attribution
    // on an audience the user rebuilt from checkboxes.
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 999 }),
      phoneListToken: 'phone-token',
      audienceSource: 'customFilters',
      audienceListId: null,
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

// ENG-10764: robocall gets the same saved-list selector as text, but its
// audience step must also keep the cost preview populated when a list is
// selected (the checkbox-based live count doesn't apply to saved lists).
describe('AudienceStep robocall saved-list selector', () => {
  const mockListDetail = (people: number) => ({
    demographics: { people, avgAge: null, avgIncome: null },
    reachability: {
      sms: 0,
      robocall: 0,
      phoneBanking: 0,
      doorKnocking: 0,
      polls: 0,
    },
    outreachHistory: [],
  })

  beforeEach(() => {
    mockCountVoterFile.mockReset()
    mockClientRequest.mockReset()
  })

  it('shows the saved-list dropdown for robocall when saved lists exist', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 42, name: 'My Super Voters' }],
    })

    render(
      <AudienceStep
        type="robocall"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
  })

  it('looks like today (checkbox-only, no dropdown) when robocall has no saved lists', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })

    render(
      <AudienceStep
        type="robocall"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText('Build a new audience')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('selecting a saved list fetches its real count for the cost preview and skips throwaway filter creation', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(500) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')
    const onChangeCallback = vi.fn()
    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="robocall"
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

    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument())
    expect(screen.getByText('$20.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).not.toHaveBeenCalled()
    // Robocall has no phone list — onCreatePhoneList must stay out of this path.
    expect(onCreatePhoneList).not.toHaveBeenCalled()
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: null,
      audienceSource: 'savedList',
      audienceListId: 42,
    })
  })

  it('surfaces an error and blocks Next when the list-detail count fetch fails', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.reject(new Error('list-detail 500'))
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="robocall"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    await waitFor(() =>
      expect(screen.getByText('Voter data unavailable')).toBeInTheDocument(),
    )

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('blocks Next when the selected saved list has zero members', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(0) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="robocall"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('keeps Next enabled for a text saved list, whose branch leaves the internal count at zero', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockResolvedValue({ data: [savedList] })

    render(
      <AudienceStep
        type="text"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('shows the voicemail-adjusted cost for a selected saved list', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(500) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    render(
      <AudienceStep
        type="robocall"
        withVoicemail
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument())
    expect(screen.getByText('$27.50')).toBeInTheDocument()
  })

  it('applies preselectedListId once the matching saved list loads for robocall', async () => {
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(200) })
      }
      return Promise.resolve({
        data: [
          { id: 42, name: 'My Super Voters' },
          { id: 43, name: 'Other List' },
        ],
      })
    })

    render(
      <AudienceStep
        type="robocall"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    expect(await screen.findByText(/Using your saved list/)).toBeInTheDocument()
    expect(screen.getAllByText('My Super Voters')).toHaveLength(2)
    expect(await screen.findByText('200')).toBeInTheDocument()
  })

  it('checkbox-filter path is unchanged for robocall', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })
    mockCountVoterFile.mockResolvedValue(150)

    const nextCallback = vi.fn()
    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')

    render(
      <AudienceStep
        type="robocall"
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
    expect(onCreatePhoneList).not.toHaveBeenCalled()
  })
})

// ENG-10765: phone banking gets the same saved-list selector as robocall
// (real count fetch, zero-member Next guard) but has no cost preview and no
// phone list — and its download step needs to know a saved list was picked.
describe('AudienceStep phone banking saved-list selector', () => {
  const mockListDetail = (people: number) => ({
    demographics: { people, avgAge: null, avgIncome: null },
    reachability: {
      sms: 0,
      robocall: 0,
      phoneBanking: 0,
      doorKnocking: 0,
      polls: 0,
    },
    outreachHistory: [],
  })

  beforeEach(() => {
    mockCountVoterFile.mockReset()
    mockClientRequest.mockReset()
  })

  it('shows the saved-list dropdown for phone banking when saved lists exist', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 42, name: 'My Super Voters' }],
    })

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
  })

  it('looks like today (checkbox-only, no dropdown) when phone banking has no saved lists', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText('Build a new audience')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('selecting a saved list fetches its real count, skips throwaway filter creation, and reports savedListId', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(500) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')
    const onChangeCallback = vi.fn()
    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="phoneBanking"
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

    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument())
    // No cost preview for phone banking — only the voters-selected number.
    expect(screen.queryByText(/Estimated cost/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).not.toHaveBeenCalled()
    // Phone banking has no phone list — onCreatePhoneList must stay out of this path.
    expect(onCreatePhoneList).not.toHaveBeenCalled()
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: null,
      audienceSource: 'savedList',
      audienceListId: 42,
      savedListId: 42,
    })
  })

  it('surfaces an error and blocks Next when the list-detail count fetch fails', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.reject(new Error('list-detail 500'))
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    await waitFor(() =>
      expect(screen.getByText('Voter data unavailable')).toBeInTheDocument(),
    )

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('blocks Next when the selected saved list has zero members', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(0) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('checkbox-filter path is unchanged for phone banking and reports no savedListId', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })
    mockCountVoterFile.mockResolvedValue(150)

    const nextCallback = vi.fn()
    const onChangeCallback = vi.fn()
    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{ audience_superVoters: true }}
        onChangeCallback={onChangeCallback}
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
    expect(onCreatePhoneList).not.toHaveBeenCalled()
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 999 }),
      phoneListToken: null,
      audienceSource: 'customFilters',
      audienceListId: null,
      savedListId: undefined,
    })
  })

  it('applies preselectedListId once the matching saved list loads for phone banking', async () => {
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(200) })
      }
      return Promise.resolve({
        data: [
          { id: 42, name: 'My Super Voters' },
          { id: 43, name: 'Other List' },
        ],
      })
    })

    render(
      <AudienceStep
        type="phoneBanking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    expect(await screen.findByText(/Using your saved list/)).toBeInTheDocument()
    expect(screen.getAllByText('My Super Voters')).toHaveLength(2)
    expect(await screen.findByText('200')).toBeInTheDocument()
  })
})

// ENG-10784: door knocking front-runs its planned rewrite to get the same
// saved-list selector as phone banking (real count fetch, zero-member Next
// guard, no cost preview, no phone list) — and its download step needs to
// know a saved list was picked so it can hit the segment export.
describe('AudienceStep door knocking saved-list selector', () => {
  const mockListDetail = (people: number) => ({
    demographics: { people, avgAge: null, avgIncome: null },
    reachability: {
      sms: 0,
      robocall: 0,
      phoneBanking: 0,
      doorKnocking: 0,
      email: null,
      metaAds: null,
    },
    outreachHistory: [],
  })

  beforeEach(() => {
    mockCountVoterFile.mockReset()
    mockClientRequest.mockReset()
  })

  it('shows the saved-list dropdown for door knocking when saved lists exist', async () => {
    mockClientRequest.mockResolvedValue({
      data: [{ id: 42, name: 'My Super Voters' }],
    })

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
  })

  it('looks like today (checkbox-only, no dropdown) when door knocking has no saved lists', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
      />,
    )

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText('Build a new audience')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('selecting a saved list fetches its real count, skips throwaway filter creation, and reports savedListId', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(500) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')
    const onChangeCallback = vi.fn()
    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="doorKnocking"
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

    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument())
    // No cost preview for door knocking — only the voters-selected number.
    expect(screen.queryByText(/Estimated cost/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(nextCallback).toHaveBeenCalled())

    expect(onCreateVoterFileFilter).not.toHaveBeenCalled()
    // Door knocking has no phone list — onCreatePhoneList must stay out of
    // this path.
    expect(onCreatePhoneList).not.toHaveBeenCalled()
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 42 }),
      phoneListToken: null,
      audienceSource: 'savedList',
      audienceListId: 42,
      savedListId: 42,
    })
  })

  it('surfaces an error and blocks Next when the list-detail count fetch fails', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.reject(new Error('list-detail 500'))
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)

    await waitFor(() =>
      expect(screen.getByText('Voter data unavailable')).toBeInTheDocument(),
    )

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('blocks Next when the selected saved list has zero members', async () => {
    const savedList = { id: 42, name: 'My Super Voters' }
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(0) })
      }
      return Promise.resolve({ data: [savedList] })
    })

    const nextCallback = vi.fn()

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={nextCallback}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    await screen.findByText(/Using your saved list/)
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument())

    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(nextButton).toBeDisabled()

    fireEvent.click(nextButton)
    expect(nextCallback).not.toHaveBeenCalled()
  })

  it('checkbox-filter path is unchanged for door knocking and reports no savedListId', async () => {
    mockClientRequest.mockResolvedValue({ data: [] })
    mockCountVoterFile.mockResolvedValue(150)

    const nextCallback = vi.fn()
    const onChangeCallback = vi.fn()
    const onCreateVoterFileFilter = vi.fn().mockResolvedValue({ id: 999 })
    const onCreatePhoneList = vi.fn().mockResolvedValue('phone-token')

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{ audience_superVoters: true }}
        onChangeCallback={onChangeCallback}
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
    expect(onCreatePhoneList).not.toHaveBeenCalled()
    expect(onChangeCallback).toHaveBeenLastCalledWith({
      voterFileFilter: expect.objectContaining({ id: 999 }),
      phoneListToken: null,
      audienceSource: 'customFilters',
      audienceListId: null,
      savedListId: undefined,
    })
  })

  it('applies preselectedListId once the matching saved list loads for door knocking', async () => {
    mockClientRequest.mockImplementation((route: string) => {
      if (route === 'GET /v1/contacts/list-detail') {
        return Promise.resolve({ data: mockListDetail(200) })
      }
      return Promise.resolve({
        data: [
          { id: 42, name: 'My Super Voters' },
          { id: 43, name: 'Other List' },
        ],
      })
    })

    render(
      <AudienceStep
        type="doorKnocking"
        audience={{}}
        onChangeCallback={vi.fn()}
        nextCallback={vi.fn()}
        backCallback={vi.fn()}
        preselectedListId={42}
      />,
    )

    expect(await screen.findByText(/Using your saved list/)).toBeInTheDocument()
    expect(screen.getAllByText('My Super Voters')).toHaveLength(2)
    expect(await screen.findByText('200')).toBeInTheDocument()
  })
})
