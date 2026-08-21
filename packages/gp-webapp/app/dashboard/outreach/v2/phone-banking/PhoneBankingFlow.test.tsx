import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  PhoneBankingCreate,
  PhoneBankingScriptDraftRequest,
} from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { router } from 'helpers/test-utils/router-mocking'
import { PhoneBankingFlow } from './PhoneBankingFlow'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// Stubs the script step's dictation wiring — not exercised by these tests,
// but ScriptStep mounts it unconditionally (same precedent as
// SocialFlow.test.tsx's ComposeStep mock).
vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle' as const,
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  }),
}))

const draftFor = ({
  purpose,
  tone,
  currentDraft,
}: PhoneBankingScriptDraftRequest) =>
  currentDraft === undefined
    ? `AI script (${tone}) for ${purpose}`
    : `Improved (${tone}): ${currentDraft}`

const mockDraft = () => {
  const calls: PhoneBankingScriptDraftRequest[] = []
  api.mock('POST /v1/outreach/phone-banking/draft', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { draft: draftFor(body) } }
  })
  return calls
}

const mockSavedLists = (lists: { id: number; name: string }[] = []) =>
  api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: lists })

const mockCount = (count = 42) =>
  api.mock('POST /v1/contacts/count', { status: 200, data: { count } })

const mockListDetail = (phoneBankingCount: number | null = 10) =>
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 20, avgAge: null, avgIncome: null },
      reachability: {
        sms: null,
        robocall: null,
        phoneBanking: phoneBankingCount,
        doorKnocking: null,
        polls: null,
      },
      outreachHistory: [],
    },
  })

const createResponse = {
  id: 5,
  name: 'Get out the vote',
  sheetCount: 1,
  entryCount: 12,
  personCount: 42,
  outreachId: 9,
}

const user = userEvent.setup()

const openFlow = (onSaved?: (outreachId: number, name: string) => void) => {
  const onClose = vi.fn()
  render(<PhoneBankingFlow open onClose={onClose} onSaved={onSaved} />)
  return { onClose }
}

const advanceToWho = async () => {
  await user.click(screen.getByText('Introduce myself'))
  expect(
    (await screen.findAllByText('Who are you calling?')).length,
  ).toBeGreaterThan(0)
}

const advanceToScript = async () => {
  await advanceToWho()
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('Write your call script')).length,
  ).toBeGreaterThan(0)
}

const advanceToSheets = async () => {
  await advanceToScript()
  await waitFor(() =>
    expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('How many lists would you like me to create?'))
      .length,
  ).toBeGreaterThan(0)
}

describe('PhoneBankingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSavedLists([])
    mockCount()
  })

  it('progresses purpose → who (default All voters) → script → sheets, creates on sheets Continue, and shows the ready screen', async () => {
    mockDraft()
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()

    expect(
      screen.getAllByText('What do you want to do?').length,
    ).toBeGreaterThan(0)
    await advanceToSheets()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      (await screen.findAllByText('Your call list is ready')).length,
    ).toBeGreaterThan(0)
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({
      purpose: 'introduce',
      sheetCount: 1,
      filters: {},
      filterName: 'All voters',
    })
    expect(createCalls[0]).not.toHaveProperty('voterFileFilterId')

    const downloadLink = screen.getByRole('link', {
      name: 'Download call sheet (PDF)',
    })
    expect(downloadLink).toHaveAttribute(
      'href',
      `/dashboard/outreach/phone-banking/print/${createResponse.id}/pdf`,
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.ListCreated,
      {
        product: 'phoneBanking',
        filtersApplied: false,
        listSize: createResponse.personCount,
      },
    )

    await user.click(downloadLink)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.SheetDownloaded,
      { listId: createResponse.id, contactCount: createResponse.personCount },
    )

    await user.click(screen.getByRole('button', { name: 'Go to call list' }))
    expect(router.push).toHaveBeenCalledWith(
      `/dashboard/outreach/phone-banking/${createResponse.id}`,
    )
  })

  it('offers a ZIP download link for a multi-sheet list', async () => {
    mockDraft()
    const multiSheetResponse = { ...createResponse, sheetCount: 3 }
    api.mock('POST /v1/phone-banking/lists', {
      status: 200,
      data: multiSheetResponse,
    })
    openFlow()
    await advanceToSheets()

    const sheetCountInput = screen.getByLabelText('Number of lists')
    await user.clear(sheetCountInput)
    await user.type(sheetCountInput, '3')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Your call lists are ready')

    const zipLink = screen.getByRole('link', {
      name: 'Download 3 call sheets (ZIP)',
    })
    expect(zipLink).toHaveAttribute(
      'href',
      `/dashboard/outreach/phone-banking/print/${multiSheetResponse.id}/pdf`,
    )
  })

  it('renders the API 400 empty-audience message inline on the sheets step', async () => {
    mockDraft()
    api.mock('POST /v1/phone-banking/lists', {
      status: 400,
      data: {
        message: 'No matching voters with a phone number — widen the filters',
      },
    })
    openFlow()
    await advanceToSheets()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(
        'No matching voters with a phone number — widen the filters',
      ),
    ).toBeInTheDocument()
    // Stays on the sheets step — no ready screen.
    expect(
      screen.getAllByText('How many lists would you like me to create?').length,
    ).toBeGreaterThan(0)
  })

  it('drafts the script with purpose + tone, and Improve with AI sends currentDraft', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await advanceToScript()

    await waitFor(() =>
      expect(draftCalls).toEqual([{ purpose: 'introduce', tone: 'warm' }]),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).toHaveValue(
        draftFor({ purpose: 'introduce', tone: 'warm' }),
      ),
    )

    // Improve with AI is visible on a fresh AI draft — no manual-edit gate.
    expect(
      screen.getByRole('button', { name: /Improve with AI/ }),
    ).toBeInTheDocument()

    const textarea = screen.getByLabelText('Call script')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(
      await screen.findByRole('button', { name: /Improve with AI/ }),
    )

    await waitFor(() =>
      expect(draftCalls).toEqual([
        { purpose: 'introduce', tone: 'warm' },
        {
          purpose: 'introduce',
          tone: 'warm',
          currentDraft: 'My own words',
        },
      ]),
    )
  })

  it('auto-suggests the campaign name from the purpose on the script step, and an empty name blocks Continue', async () => {
    mockDraft()
    openFlow()
    await advanceToScript()

    const nameInput = screen.getByLabelText('Campaign name')
    expect(nameInput).toHaveValue('Introduce myself')

    await user.clear(nameInput)
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await user.type(nameInput, 'GOTV calls')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('sends voterFileFilterId (never filters) when a saved list is chosen', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()
    await advanceToWho()

    await user.click(screen.getByRole('button', { name: 'All lists' }))
    await user.click(await screen.findByText('Likely Dems'))
    expect(
      await screen.findByText('reachable by phone banking'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('How many lists would you like me to create?')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))

    expect(createCalls[0]?.voterFileFilterId).toBe(3)
    expect(createCalls[0]).not.toHaveProperty('filters')
    expect(createCalls[0]).not.toHaveProperty('filterName')
  })

  it('disables Continue on the who step when the saved list count fails to load', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(null)
    openFlow()
    await advanceToWho()

    await user.click(screen.getByRole('button', { name: 'All lists' }))
    await user.click(await screen.findByText('Likely Dems'))

    expect(
      await screen.findByText("We couldn't count this list. Try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('builds a custom audience via the builder → naming sub-states and sends filters + filterName', async () => {
    mockDraft()
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()
    await advanceToWho()

    await user.click(screen.getByRole('button', { name: 'All lists' }))
    await user.click(await screen.findByText('Create a new list'))
    expect(
      (await screen.findAllByText('Build a voter list')).length,
    ).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Democrat' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Continue \(\d+\)/ }),
      ).toBeEnabled(),
    )
    await user.click(screen.getByRole('button', { name: /Continue \(\d+\)/ }))

    expect(
      (await screen.findAllByText('Name your list')).length,
    ).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('List name'), 'My audience')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('How many lists would you like me to create?')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))

    expect(createCalls[0]?.filterName).toBe('My audience')
    expect(createCalls[0]?.filters).toMatchObject({ partyDemocrat: true })
    expect(createCalls[0]).not.toHaveProperty('voterFileFilterId')
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.ListCreated,
      expect.objectContaining({ filtersApplied: true }),
    )
  })

  it('notifies onSaved with the outreach id and name so the hub history can update without a refetch', async () => {
    mockDraft()
    api.mock('POST /v1/phone-banking/lists', {
      status: 200,
      data: createResponse,
    })
    const onSaved = vi.fn()
    openFlow(onSaved)
    await advanceToSheets()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('Your call list is ready')

    expect(onSaved).toHaveBeenCalledWith(
      createResponse.outreachId,
      createResponse.name,
    )
  })

  it('does not call onSaved when the create response has no outreachId', async () => {
    mockDraft()
    api.mock('POST /v1/phone-banking/lists', {
      status: 200,
      data: { ...createResponse, outreachId: null },
    })
    const onSaved = vi.fn()
    openFlow(onSaved)
    await advanceToSheets()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('Your call list is ready')

    expect(onSaved).not.toHaveBeenCalled()
  })
})
