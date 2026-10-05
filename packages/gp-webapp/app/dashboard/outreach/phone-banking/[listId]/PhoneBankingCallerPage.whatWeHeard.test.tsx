import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type {
  FeedbackReportResponse,
  PhoneBankingList,
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
})
