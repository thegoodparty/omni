import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  FeedbackReportResponse,
  PhoneBankingList,
  RecordPhoneBankingCallResponse,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import PhoneBankingCallerPage from './PhoneBankingCallerPage'

vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: vi.fn(),
}))

const LIST_ID = 42
const OUTREACH_ID = 77

let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => `/dashboard/outreach/phone-banking/${LIST_ID}`,
  useSearchParams: () => mockSearchParams,
}))

const LIST: PhoneBankingList = {
  id: LIST_ID,
  name: 'Listening calls',
  script: 'Hi, I am calling to hear what matters to you.',
  sheetCount: 1,
  purpose: 'community_input',
  createdAt: new Date('2026-01-01'),
  isServe: false,
  entries: [],
}

const REPORT: FeedbackReportResponse = {
  question: 'What should the city fix first?',
  channel: 'phone_bank',
  floor: 5,
  denominators: { conversations: 12, memos: 8, confirmed: 6, pending: 2 },
  run: null,
  themes: [],
  memos: [],
}

let reportReads: string[] = []

const mockList = (list: PhoneBankingList = LIST) =>
  api.mock('GET /v1/phone-banking/lists/:id', { status: 200, data: list })

const mockReport = () =>
  api.mock(
    'GET /v1/constituent-feedback/efforts/:outreachId/report',
    ({ params }) => {
      reportReads.push(params.outreachId)
      return { status: 200, data: REPORT }
    },
  )

const setFlag = (enabled: boolean) => {
  vi.mocked(useIssueCaptureFlag).mockReturnValue({ ready: true, enabled })
}

beforeEach(() => {
  testQueryClient.clear()
  reportReads = []
  mockSearchParams = new URLSearchParams()
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
  setFlag(true)
  mockList()
  mockReport()
})

describe('PhoneBankingCallerPage: what we heard', () => {
  it('links the list to its effort’s report from the header', async () => {
    mockSearchParams = new URLSearchParams({ outreachId: String(OUTREACH_ID) })
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    const link = await screen.findByRole('link', { name: /What we heard/ })
    expect(link).toHaveAttribute(
      'href',
      `/dashboard/issue-capture/${OUTREACH_ID}`,
    )
    expect(link).toHaveTextContent('12 conversations · 8 notes')
  })

  it('links a Serve list too', async () => {
    mockList({ ...LIST, isServe: true })
    mockSearchParams = new URLSearchParams({ outreachId: String(OUTREACH_ID) })
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    expect(
      await screen.findByRole('link', { name: /What we heard/ }),
    ).toBeInTheDocument()
  })

  // Lists made without an envelope have no effort to report on, and a link
  // from an older bookmark carries none.
  it('shows nothing without an effort to report on', async () => {
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    await screen.findByRole('heading', { name: 'Listening calls' })
    expect(screen.queryByRole('link', { name: /What we heard/ })).toBeNull()
    expect(reportReads).toEqual([])
  })

  it('ignores an effort id that is not a positive integer', async () => {
    mockSearchParams = new URLSearchParams({ outreachId: '7abc' })
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    await screen.findByRole('heading', { name: 'Listening calls' })
    expect(reportReads).toEqual([])
  })

  // The report is the manager's; a volunteer's caller never offers it.
  it('shows nothing on the volunteer surface', async () => {
    mockSearchParams = new URLSearchParams({ outreachId: String(OUTREACH_ID) })
    render(
      <PhoneBankingCallerPage
        listId={LIST_ID}
        surface={{
          exitHref: '/volunteer',
          exitLabel: 'Assignments',
          showDeleteAction: false,
        }}
      />,
    )

    await screen.findByRole('heading', { name: 'Listening calls' })
    await waitFor(() => expect(reportReads).toEqual([]))
    expect(screen.queryByRole('link', { name: /What we heard/ })).toBeNull()
  })

  // The link reads the report once and has no poll of its own, so the call
  // that makes its first conversation has to tell it.
  it('counts a call and its note the moment they are confirmed', async () => {
    const user = userEvent.setup()
    mockList({
      ...LIST,
      isServe: true,
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
              firstName: 'Alex',
              age: 40,
              party: 'D',
              address: '1 Main St',
              cellPhone: '5551110001',
              landline: null,
              interaction: null,
            },
          ],
        },
      ],
    })
    let answered = false
    api.mock(
      'GET /v1/constituent-feedback/efforts/:outreachId/report',
      ({ params }) => {
        reportReads.push(params.outreachId)
        return {
          status: 200,
          data: {
            ...REPORT,
            denominators: answered
              ? { conversations: 1, memos: 1, confirmed: 1, pending: 0 }
              : { conversations: 0, memos: 0, confirmed: 0, pending: 0 },
          },
        }
      },
    )
    api.mock('POST /v1/phone-banking/lists/:id/calls', () => {
      answered = true
      const response: RecordPhoneBankingCallResponse = {
        entryId: 1,
        results: [
          {
            personId: 'solo-1',
            interaction: {
              outcome: 'answered',
              supportAnswer: null,
              willVote: null,
              followUp: 'yes',
              occurredAt: new Date(),
            },
          },
        ],
        envelopeCompleted: false,
      }
      return { status: 200, data: response }
    })
    api.mock('POST /v1/constituent-feedback', {
      status: 200,
      data: {
        id: 'feedback-1',
        personId: 'solo-1',
        extractionStatus: 'extracted',
        extraction: {
          issues: [
            {
              id: 'issue-crosswalk',
              position: 0,
              issueLabel: 'Crosswalk on Main',
              stance: 'supports',
              desiredOutcome: 'A signal at Main and 3rd',
            },
          ],
        },
      },
    })
    api.mock('PATCH /v1/constituent-feedback/:id/confirm', {
      status: 200,
      data: {
        id: 'feedback-1',
        personId: 'solo-1',
        occurredAt: new Date(),
        channel: 'phone_bank',
        transcript: 'Wants a crosswalk on Main.',
        issues: [
          {
            id: 'issue-crosswalk',
            position: 0,
            issueLabel: 'Crosswalk on Main',
            stance: 'supports',
            desiredOutcome: 'A signal at Main and 3rd',
          },
        ],
        extractionStatus: 'extracted',
        confirmedAt: new Date(),
        outreachId: OUTREACH_ID,
        actorName: 'Kamal Al Sawafi',
        tags: [],
      },
    })
    mockSearchParams = new URLSearchParams({ outreachId: String(OUTREACH_ID) })
    render(<PhoneBankingCallerPage listId={LIST_ID} />)

    await screen.findByRole('heading', { name: 'Listening calls' })
    await waitFor(() => expect(reportReads).toHaveLength(1))
    expect(screen.queryByRole('link', { name: /What we heard/ })).toBeNull()

    await user.click(screen.getByText('Alex Solo'))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Engaged' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    await user.type(
      within(dialog).getByRole('textbox'),
      'Wants a crosswalk on Main.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await user.click(
      await within(dialog).findByRole('button', { name: 'Looks right' }),
    )
    await waitFor(() =>
      expect(
        within(dialog).queryByRole('button', { name: 'Looks right' }),
      ).toBeNull(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(
      await screen.findByRole('link', { name: /What we heard/ }),
    ).toHaveTextContent('1 conversation · 1 note')
  })
})
