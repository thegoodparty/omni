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

// useListWizardCount (reached in the audience builder) reads the active org
// slug — same precedent as RobocallFlow.test.tsx.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
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

// phoneBanking reads reachability off the list-detail aggregate — same shape
// robocall reads its landline count from.
const mockListDetail = (phoneBankingCount: number | null) =>
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

const mockCreateList = (id = 99, name = 'My audience') =>
  api.mock('POST /v1/voters/voter-file/filter', {
    status: 200,
    data: { id, name },
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
  await user.click(screen.getByText('Introduce myself to voters'))
  expect(
    (await screen.findAllByText('Who are you calling?')).length,
  ).toBeGreaterThan(0)
}

// Picks the (single, already-mocked) saved list from the "Choose a voter
// list" picker and advances Continue — the who step's default path now that
// there is no "All voters" default (ENG-10930).
const pickSavedListAndContinue = async (listName: string) => {
  await user.click(screen.getByText('Choose a voter list'))
  await user.click(await screen.findByText(listName))
  await user.click(
    await screen.findByRole('button', { name: /Continue \([\d,]+\)/ }),
  )
}

const advanceToScript = async () => {
  mockSavedLists([{ id: 3, name: 'Likely Dems' }])
  mockListDetail(10)
  await advanceToWho()
  await pickSavedListAndContinue('Likely Dems')
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
    (
      await screen.findAllByText(
        'How many call sheets would you like me to create?',
      )
    ).length,
  ).toBeGreaterThan(0)
}

describe('PhoneBankingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSavedLists([])
    mockCount()
    // useElectedOffice fires on mount (no enable guard, via
    // useOutreachAudience); 404 => not an elected official.
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
  })

  it('opens the who step with no default audience — Continue is disabled until a list is picked or built', async () => {
    openFlow()
    await advanceToWho()

    expect(screen.queryByText('Recommended list')).not.toBeInTheDocument()
    expect(screen.queryByText('All voters')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('sends voterFileFilterId (never inline filters) when a saved list is chosen, creates on sheets Continue, and shows the ready screen', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()

    expect(
      screen.getAllByText('What do you want to do?').length,
    ).toBeGreaterThan(0)
    await advanceToWho()

    // 10 reachable voters, no cost line — phone banking is free.
    expect(
      screen.getByText(/may change based on the mode of outreach/),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Likely Dems'))
    expect(
      await screen.findByText(/Reach 10 voters by phone banking/),
    ).toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', { name: /Continue \(10\)/ }),
    )

    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      (await screen.findAllByText('Your call sheet is ready')).length,
    ).toBeGreaterThan(0)
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({
      purpose: 'introduce',
      sheetCount: 1,
      voterFileFilterId: 3,
    })
    expect(createCalls[0]).not.toHaveProperty('filters')
    expect(createCalls[0]).not.toHaveProperty('filterName')

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
        filtersApplied: true,
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

    const sheetCountInput = screen.getByLabelText('Number of call sheets')
    await user.clear(sheetCountInput)
    await user.type(sheetCountInput, '3')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Your call sheets are ready')

    const zipLink = screen.getByRole('link', {
      name: 'Download 3 call sheets (ZIP)',
    })
    expect(zipLink).toHaveAttribute(
      'href',
      `/dashboard/outreach/phone-banking/print/${multiSheetResponse.id}/pdf`,
    )
  })

  it('backspacing the sheet-count field to empty then typing a digit commits that digit, not the digit appended to a stale 1 (ENG-10940)', async () => {
    mockDraft()
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: { ...createResponse, sheetCount: 5 } }
    })
    openFlow()
    await advanceToSheets()

    const sheetCountInput = screen.getByLabelText(
      'Number of call sheets',
    ) as HTMLInputElement
    expect(sheetCountInput.value).toBe('1')

    await user.clear(sheetCountInput)
    expect(sheetCountInput.value).toBe('')

    await user.type(sheetCountInput, '5')
    expect(sheetCountInput.value).toBe('5')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0]).toMatchObject({ sheetCount: 5 })
  })

  it('normalizes trailing junk immediately when it parses to the value already committed (no permanent display desync)', async () => {
    mockDraft()
    openFlow()
    await advanceToSheets()

    const sheetCountInput = screen.getByLabelText(
      'Number of call sheets',
    ) as HTMLInputElement

    await user.clear(sheetCountInput)
    await user.type(sheetCountInput, '5')
    expect(sheetCountInput.value).toBe('5')

    // "5.9" still parses (via parseInt) to the already-committed 5, and
    // unlike a leading zero it's a well-formed float the number input won't
    // silently re-sanitize on its own — a fix that only re-syncs off a
    // sheetCount prop CHANGE would leave "5.9" on screen forever, since a
    // same-value commit never fires that effect.
    await user.type(sheetCountInput, '.9')
    expect(sheetCountInput.value).toBe('5')
  })

  it('snaps an out-of-range typed value back to the last committed value on blur, and never commits it', async () => {
    mockDraft()
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()
    await advanceToSheets()

    const sheetCountInput = screen.getByLabelText(
      'Number of call sheets',
    ) as HTMLInputElement

    await user.clear(sheetCountInput)
    await user.type(sheetCountInput, '0')
    expect(sheetCountInput.value).toBe('0')
    await user.tab()
    expect(sheetCountInput.value).toBe('1')

    // Typing "99" commits its valid "9" prefix along the way (each keystroke
    // that parses in range propagates immediately), then the final
    // out-of-range "99" is never committed — blur snaps back to that last
    // valid prefix, not to whatever preceded this whole edit.
    await user.clear(sheetCountInput)
    await user.type(sheetCountInput, '99')
    expect(sheetCountInput.value).toBe('99')
    await user.tab()
    expect(sheetCountInput.value).toBe('9')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0]).toMatchObject({ sheetCount: 9 })
  })

  it('restores the last committed value when the field is left empty on blur', async () => {
    mockDraft()
    openFlow()
    await advanceToSheets()

    const sheetCountInput = screen.getByLabelText(
      'Number of call sheets',
    ) as HTMLInputElement
    await user.clear(sheetCountInput)
    expect(sheetCountInput.value).toBe('')
    await user.tab()
    expect(sheetCountInput.value).toBe('1')
  })

  it('shows the per-sheet capacity and computed coverage against the real reachable count', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    openFlow()
    await advanceToSheets()

    expect(
      screen.getByText('Each call sheet holds 60 numbers.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 sheet × 60 = up to 60 of your 10 reachable contacts'),
    ).toBeInTheDocument()
  })

  it('defaults the sheet count to cover a large audience, capped at 20, and warns when even the cap will not cover it', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Huge list' }])
    mockListDetail(2000)
    openFlow()
    await advanceToWho()
    await pickSavedListAndContinue('Huge list')
    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )

    const sheetCountInput = screen.getByLabelText(
      'Number of call sheets',
    ) as HTMLInputElement
    // ceil(2000 / 60) = 34, capped at PHONE_BANKING_MAX_SHEET_COUNT.
    expect(sheetCountInput.value).toBe('20')
    expect(
      screen.getByText(
        '20 sheets × 60 = up to 1,200 of your 2,000 reachable contacts',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Only the first ~1,200 contacts will be included; 800 won't be called.",
      ),
    ).toBeInTheDocument()
  })

  it('states both numbers on the download step when the audience was truncated', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Huge list' }])
    mockListDetail(2000)
    api.mock('POST /v1/phone-banking/lists', {
      status: 200,
      data: { ...createResponse, personCount: 1200 },
    })
    openFlow()
    await advanceToWho()
    await pickSavedListAndContinue('Huge list')
    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('1,200 contacts frozen from 2,000 reachable.'),
    ).toBeInTheDocument()
  })

  it('shows no reconciliation copy on the download step when the audience was not truncated', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    api.mock('POST /v1/phone-banking/lists', {
      status: 200,
      data: { ...createResponse, personCount: 10 },
    })
    openFlow()
    await advanceToSheets()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findAllByText('Your call sheet is ready')
    expect(screen.queryByText(/contacts frozen from/)).not.toBeInTheDocument()
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
      screen.getAllByText('How many call sheets would you like me to create?')
        .length,
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

  it('sends trimmed instructions on Regenerate and Improve with AI, omitting them when blank', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await advanceToScript()

    await waitFor(() => expect(draftCalls).toHaveLength(1))
    expect(draftCalls[0]).not.toHaveProperty('instructions')

    await user.type(
      screen.getByLabelText('Instructions for the AI'),
      '  mention the school levy  ',
    )
    await user.click(screen.getByRole('button', { name: /Regenerate/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(2))
    expect(draftCalls[1]).toMatchObject({
      instructions: 'mention the school levy',
    })

    const textarea = screen.getByLabelText('Call script')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(
      await screen.findByRole('button', { name: /Improve with AI/ }),
    )
    await waitFor(() => expect(draftCalls).toHaveLength(3))
    expect(draftCalls[2]).toMatchObject({
      currentDraft: 'My own words',
      instructions: 'mention the school levy',
    })
  })

  it('sends previousDraft on Regenerate and on a tone change, omitting it on first generation', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await advanceToScript()

    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).toHaveValue(
        draftFor({ purpose: 'introduce', tone: 'warm' }),
      ),
    )
    // First generation has nothing to reject.
    expect(draftCalls[0]).not.toHaveProperty('previousDraft')

    await user.click(screen.getByRole('button', { name: /Regenerate/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(2))
    expect(draftCalls[1]).toMatchObject({
      previousDraft: draftFor({ purpose: 'introduce', tone: 'warm' }),
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    const scriptBeforeToneChange = (
      screen.getByLabelText('Call script') as HTMLTextAreaElement
    ).value
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(3))
    expect(draftCalls[2]).toMatchObject({
      tone: 'direct',
      previousDraft: scriptBeforeToneChange,
    })
  })

  it('omits previousDraft on a tone change after the candidate manually edited the script, so their edits are never told to diverge from', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await advanceToScript()

    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    expect(draftCalls).toHaveLength(1)

    const textarea = screen.getByLabelText('Call script')
    await user.clear(textarea)
    await user.type(textarea, 'My hand-edited script')

    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(2))
    expect(draftCalls[1]).toMatchObject({ tone: 'direct' })
    expect(draftCalls[1]).not.toHaveProperty('previousDraft')

    // A later tone change, with no further edits since that AI draft
    // landed, goes back to sending previousDraft — the guard is per-edit,
    // not sticky for the rest of the session.
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).toHaveValue(
        draftFor({ purpose: 'introduce', tone: 'direct' }),
      ),
    )
    await user.click(screen.getByRole('radio', { name: /Urgent/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(3))
    expect(draftCalls[2]).toMatchObject({
      tone: 'urgent',
      previousDraft: draftFor({ purpose: 'introduce', tone: 'direct' }),
    })
  })

  it('clears instructions on a purpose re-pick, so the immediate draft for the new purpose omits them', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await advanceToScript()
    await waitFor(() => expect(draftCalls).toHaveLength(1))

    await user.type(
      screen.getByLabelText('Instructions for the AI'),
      'mention the school levy',
    )

    // script -> who -> purpose (picker mode keeps the pick on the first Back,
    // then resets on the second — see PhoneBankingFlow's handleBack).
    await user.click(screen.getByLabelText('Back'))
    await user.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()

    await user.click(screen.getByText('Persuade likely voters'))

    await waitFor(() => expect(draftCalls).toHaveLength(2))
    expect(draftCalls[1]).toMatchObject({ purpose: 'persuade', tone: 'warm' })
    expect(draftCalls[1]).not.toHaveProperty('instructions')

    await pickSavedListAndContinue('Likely Dems')
    await screen.findAllByText('Write your call script')
    expect(screen.getByLabelText('Instructions for the AI')).toHaveValue('')
  })

  it('auto-suggests the campaign name from the purpose on the script step, and an empty name blocks Continue', async () => {
    mockDraft()
    openFlow()
    await advanceToScript()

    const nameInput = screen.getByLabelText('Campaign name')
    // The card copy is "Introduce myself to voters"; the name field gets the
    // purpose's own short suggestion instead.
    expect(nameInput).toHaveValue('Introduction calls')

    await user.clear(nameInput)
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await user.type(nameInput, 'GOTV calls')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('does not auto-suggest a name for the custom purpose (the caller is writing their own script)', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    openFlow()
    await user.click(screen.getByText('Write my own script'))
    await pickSavedListAndContinue('Likely Dems')
    await screen.findAllByText('Write your call script')

    expect(screen.getByLabelText('Campaign name')).toHaveValue('')
    await user.type(screen.getByLabelText('Call script'), 'My own script')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('disables Continue on the who step when the saved list count is unavailable', async () => {
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(null)
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Likely Dems'))

    expect(
      await screen.findByText("We couldn't count this list right now."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('discards the selected list when backing off the who step', async () => {
    mockSavedLists([{ id: 3, name: 'Likely Dems' }])
    mockListDetail(10)
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Likely Dems'))
    await screen.findByRole('button', { name: /Continue \(10\)/ })

    // Back to purpose discards the pick; re-entering who is a fresh picker
    // with Continue disabled, not a resumed selection.
    await user.click(screen.getByLabelText('Back'))
    expect(screen.getByText('Introduce myself to voters')).toBeInTheDocument()
    await user.click(screen.getByText('Introduce myself to voters'))

    expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(),
    )
  })

  it('keeps the selected list when backing from script into who (only backing OFF who discards it)', async () => {
    mockDraft()
    openFlow()
    await advanceToScript()

    await user.click(screen.getByLabelText('Back'))
    expect(await screen.findByText('Likely Dems')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /Continue \(10\)/ }),
    ).toBeEnabled()
  })

  it('offers the full CRM filter vocabulary in the builder — not just voter likelihood/party/cell/landline', async () => {
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Create a new list'))
    expect(
      (await screen.findAllByText('Build a voter list')).length,
    ).toBeGreaterThan(0)

    // Dimensions the old 4-field inline builder never exposed.
    expect(screen.getByText('Ethnicity')).toBeInTheDocument()
    expect(screen.getByText('African American')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('Spanish')).toBeInTheDocument()
    expect(screen.getByText('Household income range')).toBeInTheDocument()
    expect(screen.getByText('Marital status')).toBeInTheDocument()
    // The original four dimensions are still present too (parity, not loss).
    expect(screen.getByText('Voter likelihood')).toBeInTheDocument()
    expect(screen.getByText('Political party')).toBeInTheDocument()
  })

  // ENG-10948: phone banking dials whichever number a voter has (cell first),
  // so the cell phone/landline filter groups need to read as optional
  // narrowing rather than a reachability requirement.
  it('explains any-phone dialing above the filter builder', async () => {
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Create a new list'))
    expect(
      (await screen.findAllByText('Build a voter list')).length,
    ).toBeGreaterThan(0)

    expect(
      screen.getByText(
        'Phone banking calls whichever number a voter has, cell first. The cell phone and landline filters are optional narrowing.',
      ),
    ).toBeInTheDocument()
  })

  it('applies the any-phone overlay to the builder count but never to the saved list', async () => {
    mockDraft()
    const countBodies: Record<string, unknown>[] = []
    api.mock('POST /v1/contacts/count', ({ body }) => {
      countBodies.push(body)
      return { status: 200, data: { count: 50 } }
    })
    const createListCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      createListCalls.push(body)
      return { status: 200, data: { id: 99, name: 'My audience' } }
    })
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Create a new list'))
    await user.click(screen.getByRole('button', { name: 'Democrat' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Continue \(\d+\)/ }),
      ).toBeEnabled(),
    )
    expect(countBodies.at(-1)).toMatchObject({
      partyDemocrat: true,
      hasAnyPhone: true,
    })

    await user.click(screen.getByRole('button', { name: /Continue \(\d+\)/ }))
    await screen.findAllByText('Name your list')
    await user.type(screen.getByLabelText('List name'), 'My audience')
    await user.click(screen.getByRole('button', { name: 'Create list' }))
    await screen.findAllByText('Write your call script')

    expect(createListCalls[0]).toMatchObject({ partyDemocrat: true })
    expect(createListCalls[0]).not.toHaveProperty('hasAnyPhone')
  })

  it("shows how many of the list's contacts have a phone number when some don't", async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'All voters' }])
    mockListDetail(10)
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('All voters'))

    expect(
      await screen.findByText(
        "10 of this list's 20 contacts have a phone number and will be included.",
      ),
    ).toBeInTheDocument()
  })

  it('omits the phone-number delta when every contact has a phone', async () => {
    mockDraft()
    mockSavedLists([{ id: 3, name: 'All voters' }])
    mockListDetail(20)
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('All voters'))
    await screen.findByRole('button', { name: /Continue \(20\)/ })

    expect(screen.queryByText(/have a phone number/)).not.toBeInTheDocument()
  })

  it('builds a custom audience via the builder → naming sub-states, persists it, and sends its id', async () => {
    mockDraft()
    mockCount(50)
    mockCreateList(99, 'My audience')
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()
    await advanceToWho()

    await user.click(screen.getByText('Choose a voter list'))
    await user.click(await screen.findByText('Create a new list'))
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

    const createListCalls: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      createListCalls.push(body)
      return { status: 200, data: { id: 99, name: 'My audience' } }
    })
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    await screen.findAllByText('Write your call script')
    expect(createListCalls[0]).toMatchObject({
      name: 'My audience',
      partyDemocrat: true,
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))

    expect(createCalls[0]?.voterFileFilterId).toBe(99)
    expect(createCalls[0]).not.toHaveProperty('filters')
    expect(createCalls[0]).not.toHaveProperty('filterName')
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
    await screen.findAllByText('Your call sheet is ready')

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
    await screen.findAllByText('Your call sheet is ready')

    expect(onSaved).not.toHaveBeenCalled()
  })
})
