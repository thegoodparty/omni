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
  api.mock('POST /outreach/phone-banking/draft', ({ body }) => {
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

const openFlow = () => {
  const onClose = vi.fn()
  render(<PhoneBankingFlow open onClose={onClose} />)
  return { onClose }
}

const advanceToWho = async () => {
  await user.click(screen.getByText('Introduce myself'))
  expect(
    (await screen.findAllByText('Who do you want to call?')).length,
  ).toBeGreaterThan(0)
}

const advanceToScript = async () => {
  await advanceToWho()
  await user.type(screen.getByLabelText('List name'), 'My audience')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('What do you want to say?')).length,
  ).toBeGreaterThan(0)
}

const advanceToDownload = async () => {
  await advanceToScript()
  await waitFor(() =>
    expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('How many sheets do you need?')).length,
  ).toBeGreaterThan(0)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('Ready to build your call list')).length,
  ).toBeGreaterThan(0)
}

describe('PhoneBankingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSavedLists([])
    mockCount()
  })

  it('progresses purpose → who → script → sheets → download, creates, and shows success', async () => {
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
    await advanceToDownload()

    const nameInput = screen.getByLabelText('Campaign name')
    expect(nameInput).toHaveValue('Introduce myself')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByText('Your call list is ready!'),
    ).toBeInTheDocument()
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toMatchObject({
      purpose: 'introduce',
      sheetCount: 1,
      filterName: 'My audience',
    })
    expect(
      screen.getByRole('link', { name: 'Download call sheets (PDF)' }),
    ).toHaveAttribute(
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
  })

  it('renders the API 400 empty-audience message inline', async () => {
    mockDraft()
    api.mock('POST /v1/phone-banking/lists', {
      status: 400,
      data: {
        message: 'No matching voters with a phone number — widen the filters',
      },
    })
    openFlow()
    await advanceToDownload()

    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByText(
        'No matching voters with a phone number — widen the filters',
      ),
    ).toBeInTheDocument()
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

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('Likely Dems'))
    expect(
      await screen.findByText('reachable by phone banking'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('What do you want to say?')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('How many sheets do you need?')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText('Ready to build your call list')

    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))

    expect(createCalls[0]?.voterFileFilterId).toBe(3)
    expect(createCalls[0]).not.toHaveProperty('filters')
    expect(createCalls[0]).not.toHaveProperty('filterName')
  })

  it('sends filters + filterName (never voterFileFilterId) when building an inline audience', async () => {
    mockDraft()
    const createCalls: PhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: createResponse }
    })
    openFlow()
    await advanceToDownload()

    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createCalls).toHaveLength(1))

    expect(createCalls[0]?.filterName).toBe('My audience')
    expect(createCalls[0]?.filters).toBeDefined()
    expect(createCalls[0]).not.toHaveProperty('voterFileFilterId')
  })
})
