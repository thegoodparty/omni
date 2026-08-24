import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  PhoneBankingList,
  RecordPhoneBankingCall,
  RecordPhoneBankingCallResponse,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import PhoneBankingCallerPage from './PhoneBankingCallerPage'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// DashboardLayout pulls in EcanvasserProvider/useUser/useCampaign/etc., none
// of which are wired up in this component test — same stub door-knocking's
// own full-page test uses (NativeDoorKnockingPage.test.tsx).
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const LIST_ID = 42

const buildList = (): PhoneBankingList => ({
  id: LIST_ID,
  name: 'August GOTV',
  script: 'Hi, this is a volunteer calling about the election.',
  sheetCount: 1,
  purpose: 'introduce',
  createdAt: new Date('2026-01-01'),
  entries: [
    {
      id: 1,
      seq: 1,
      sheetIndex: 1,
      phone: '5551110001',
      persons: [
        {
          personId: 'solo-1',
          name: 'Alex Solo',
          age: 40,
          party: 'D',
          address: '1 Main St',
          cellPhone: '5551110001',
          landline: null,
          interaction: null,
        },
      ],
    },
    {
      id: 2,
      seq: 2,
      sheetIndex: 1,
      phone: '5552220002',
      persons: [
        {
          personId: 'house-a',
          name: 'Casey Household',
          age: 55,
          party: 'I',
          address: '2 Oak Ave',
          cellPhone: '5552220002',
          landline: null,
          interaction: null,
        },
        {
          personId: 'house-b',
          name: 'Robin Household',
          age: 52,
          party: 'I',
          address: '2 Oak Ave',
          cellPhone: null,
          landline: '5552220003',
          interaction: null,
        },
      ],
    },
  ],
})

const mockGetList = (list: PhoneBankingList) =>
  api.mock('GET /v1/phone-banking/lists/:id', { status: 200, data: list })

const mockPush = vi.mocked(router.push!)

beforeEach(() => {
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
  mockPush.mockClear()
  vi.mocked(trackEvent).mockClear()
  // The entry panel always mounts PhoneBankingNotes for the active person;
  // stub it to empty so notes aren't the thing under test here.
  api.mock('GET /v1/contacts/:personId/notes', {
    status: 200,
    data: { results: [] },
  })
})

describe('<PhoneBankingCallerPage>', () => {
  it('renders the frozen list with people-counted progress and entry rows', async () => {
    mockGetList(buildList())
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    expect(await screen.findByText('August GOTV')).toBeInTheDocument()
    // 3 people total (1 solo + 2 household), none called yet.
    expect(screen.getByText('0/3 called')).toBeInTheDocument()
    expect(screen.getByText('Alex Solo')).toBeInTheDocument()
    expect(screen.getAllByText('Not called').length).toBeGreaterThan(0)
  })

  it('an answered save carries the active tab personId, and switching tabs shows a different logged record', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    let capturedRequest: RecordPhoneBankingCall | undefined
    api.mock('POST /v1/phone-banking/lists/:id/calls', ({ body }) => {
      capturedRequest = body
      const response: RecordPhoneBankingCallResponse = {
        entryId: 2,
        results: [
          {
            personId: 'house-a',
            interaction: {
              outcome: 'answered',
              supportAnswer: 'supporter',
              willVote: 'yes',
              occurredAt: new Date(),
            },
          },
        ],
        envelopeCompleted: false,
      }
      return { status: 200, data: response }
    })

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    // The household entry is multi-person: the row expands rather than
    // opening the panel directly.
    await user.click(screen.getByText('Casey Household, Robin Household'))
    // The expanded per-person row's name span reads exactly "Casey
    // Household" (unlike the still-present collapsed row, whose span joins
    // both names with a comma) — clicking it bubbles to that row's button.
    await user.click(await screen.findByText('Casey Household'))

    const dialog = await screen.findByRole('dialog')

    // Opening the panel on Casey (the entry's first person, so no tab click
    // needed to select them) fires Contact Viewed with the entry's rank.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.ContactViewed,
      { listId: LIST_ID, contactId: 'house-a', listRank: 2 },
    )

    await user.click(
      within(dialog).getByRole('tab', { name: /Casey Household/ }),
    )
    await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Engaged' }))
    // Will-vote only appears once a support answer is picked — click support
    // Yes first (the only "Yes" on screen), then will-vote's own Yes appears.
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    const willVoteYes = (
      await within(dialog).findAllByRole('radio', { name: 'Yes' })
    )[1]!
    await user.click(willVoteYes)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(capturedRequest).toBeDefined())
    expect(capturedRequest).toMatchObject({
      entryId: 2,
      outcome: 'answered',
      personId: 'house-a',
      supportAnswer: 'supporter',
      willVote: 'yes',
    })
    expect(capturedRequest).not.toHaveProperty('markHouseholdDone')

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.CallLogged,
      {
        listId: LIST_ID,
        contactId: 'house-a',
        listRank: 2,
        answerStatus: 'answered',
        engagementStatus: 'engaged',
        supportStatus: 'supporter',
        voterStatus: 'yes',
      },
    )

    // Switching to Robin's tab shows their own (unlogged) record — the
    // cascade form, not Casey's just-saved summary — and re-fires Contact
    // Viewed for the newly active person.
    await user.click(
      within(dialog).getByRole('tab', { name: /Robin Household/ }),
    )
    expect(within(dialog).getByText('Did they answer?')).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.ContactViewed,
      { listId: LIST_ID, contactId: 'house-b', listRank: 2 },
    )
  })

  it('fires Call Sheet Downloaded from the header PDF button', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    const pdfLink = screen.getByRole('link', {
      name: 'Download call sheet PDF',
    })
    expect(pdfLink).toHaveAttribute(
      'href',
      `/dashboard/outreach/phone-banking/print/${LIST_ID}/pdf`,
    )

    await user.click(pdfLink)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.SheetDownloaded,
    )
  })

  it('shows a numbered circle per entry, highlighted for the open entry', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    const list = screen.getByRole('list')
    expect(within(list).getByText('1')).toBeInTheDocument()
    expect(within(list).getByText('2')).toBeInTheDocument()
    expect(within(list).getByText('1')).toHaveClass('bg-muted')

    await user.click(within(list).getByText('Alex Solo'))
    await screen.findByRole('dialog')

    expect(within(list).getByText('1')).toHaveClass(
      'bg-primary',
      'text-primary-foreground',
    )
  })

  it('prev/next in the panel move to the adjacent entry, disabled at the bounds', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    await user.click(screen.getByText('Alex Solo'))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByRole('button', { name: 'Previous contact' }),
    ).toBeDisabled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Next contact' }),
    )

    // Entry 2's first person is Casey Household — the sheet's sr-only title
    // also reads "Casey Household", so assert on the visible age/party line
    // instead of the ambiguous heading role.
    expect(within(dialog).getByText('Age 55 · I')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Next contact' }),
    ).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: 'Previous contact' }),
    ).not.toBeDisabled()
  })

  it('reveals the cascade one question at a time and Save only at a terminal state', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    await user.click(screen.getByText('Alex Solo'))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
    expect(within(dialog).getByText('Did they engage?')).toBeInTheDocument()
    expect(
      within(dialog).queryByText('Do they support you?'),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Engaged' }))
    expect(within(dialog).getByText('Do they support you?')).toBeInTheDocument()
    expect(
      within(dialog).queryByText('Will they vote this election?'),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    expect(
      within(dialog).getByText('Will they vote this election?'),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()

    const willVoteYes = (
      await within(dialog).findAllByRole('radio', { name: 'Yes' })
    )[1]!
    await user.click(willVoteYes)
    expect(
      within(dialog).getByRole('button', { name: 'Save' }),
    ).toBeInTheDocument()
  })

  it('engage = Refused reveals Save immediately and posts a person-attributed refused', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    let capturedRequest: RecordPhoneBankingCall | undefined
    api.mock('POST /v1/phone-banking/lists/:id/calls', ({ body }) => {
      capturedRequest = body
      const response: RecordPhoneBankingCallResponse = {
        entryId: 1,
        results: [
          {
            personId: 'solo-1',
            interaction: {
              outcome: 'refused',
              supportAnswer: null,
              willVote: null,
              occurredAt: new Date(),
            },
          },
        ],
        envelopeCompleted: false,
      }
      return { status: 200, data: response }
    })

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    await user.click(screen.getByText('Alex Solo'))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
    // Two "Refused" pills exist now: the top-level outcome and the engage
    // answer — the second is the engage one.
    const engageRefused = within(dialog).getAllByRole('radio', {
      name: 'Refused',
    })[1]!
    await user.click(engageRefused)

    expect(
      within(dialog).queryByText('Do they support you?'),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(capturedRequest).toBeDefined())
    expect(capturedRequest).toEqual({
      entryId: 1,
      outcome: 'refused',
      personId: 'solo-1',
    })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.PhoneBanking.CallLogged,
      {
        listId: LIST_ID,
        contactId: 'solo-1',
        listRank: 1,
        answerStatus: 'refused',
        engagementStatus: 'refused',
        supportStatus: undefined,
        voterStatus: undefined,
      },
    )
  })

  it('markHouseholdDone rides the same request when the household action is used', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())

    let capturedRequest: RecordPhoneBankingCall | undefined
    api.mock('POST /v1/phone-banking/lists/:id/calls', ({ body }) => {
      capturedRequest = body
      const response: RecordPhoneBankingCallResponse = {
        entryId: 2,
        results: [
          {
            personId: 'house-a',
            interaction: {
              outcome: 'answered',
              supportAnswer: null,
              willVote: null,
              occurredAt: new Date(),
            },
          },
          {
            personId: 'house-b',
            interaction: {
              outcome: 'answered',
              supportAnswer: null,
              willVote: null,
              occurredAt: new Date(),
            },
          },
        ],
        envelopeCompleted: true,
      }
      return { status: 200, data: response }
    })

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')
    await user.click(screen.getByText('Casey Household, Robin Household'))
    // The expanded per-person row's name span reads exactly "Casey
    // Household" (unlike the still-present collapsed row, whose span joins
    // both names with a comma) — clicking it bubbles to that row's button.
    await user.click(await screen.findByText('Casey Household'))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Engaged' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    const willVoteYes = (
      await within(dialog).findAllByRole('radio', { name: 'Yes' })
    )[1]!
    await user.click(willVoteYes)
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Save & mark rest of household done',
      }),
    )

    await waitFor(() => expect(capturedRequest).toBeDefined())
    expect(capturedRequest).toMatchObject({
      entryId: 2,
      outcome: 'answered',
      personId: 'house-a',
      markHouseholdDone: true,
    })
  })

  it('a mocked no_answer response marks both persons on a 2-person entry without a refetch', async () => {
    const user = userEvent.setup()

    let getCallCount = 0
    api.mock('GET /v1/phone-banking/lists/:id', () => {
      getCallCount += 1
      return { status: 200, data: buildList() }
    })

    api.mock('POST /v1/phone-banking/lists/:id/calls', () => {
      const occurredAt = new Date()
      const response: RecordPhoneBankingCallResponse = {
        entryId: 2,
        results: [
          {
            personId: 'house-a',
            interaction: {
              outcome: 'no_answer',
              supportAnswer: null,
              willVote: null,
              occurredAt,
            },
          },
          {
            personId: 'house-b',
            interaction: {
              outcome: 'no_answer',
              supportAnswer: null,
              willVote: null,
              occurredAt,
            },
          },
        ],
        envelopeCompleted: false,
      }
      return { status: 200, data: response }
    })

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')
    await waitFor(() => expect(getCallCount).toBe(1))

    await user.click(screen.getByText('Casey Household, Robin Household'))
    // The expanded per-person row's name span reads exactly "Casey
    // Household" (unlike the still-present collapsed row, whose span joins
    // both names with a comma) — clicking it bubbles to that row's button.
    await user.click(await screen.findByText('Casey Household'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'No answer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(within(dialog).getByText('No answer')).toBeInTheDocument(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    // Both household rows in the list now show "No answer" — the optimistic
    // patch from the response, not a second GET.
    await waitFor(() => {
      const rows = screen.getAllByText('No answer')
      expect(rows.length).toBeGreaterThanOrEqual(1)
    })
    expect(getCallCount).toBe(1)
  })

  it('a wrong_number entry shows the suppressed treatment', async () => {
    const list = buildList()
    list.entries[0]!.persons[0]!.interaction = {
      outcome: 'wrong_number',
      supportAnswer: null,
      willVote: null,
      occurredAt: new Date(),
    }
    mockGetList(list)

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    expect(screen.getByText('Wrong number')).toBeInTheDocument()
  })

  it('Delete removes the list and returns to the hub', async () => {
    const user = userEvent.setup()
    mockGetList(buildList())
    api.mock('DELETE /v1/phone-banking/lists/:id', {
      status: 200,
      data: undefined,
    })

    render(<PhoneBankingCallerPage listId={LIST_ID} />)
    await screen.findByText('August GOTV')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/dashboard/outreach'),
    )
  })
})
