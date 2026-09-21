import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'
import ConstituentOutreachPage from './ConstituentOutreachPage'

// The list refresh the page hands SmsFlow as `onScheduled`, on its own.
//
// It is awaited by SmsFlow's handleScheduled, which is awaited by
// SmsReviewStep's completion handler, whose rejection path is the checkout
// form's onError — an error snackbar and a payment-failure state. By then the
// money has moved, so a refresh that throws tells someone their successful
// payment failed. These assert the only property that matters: the handler
// settles, whatever the network does.
//
// SmsFlow is stubbed rather than driven, because the assertion is about the
// function the page passes down, not about the five steps above it. The real
// flow, the flag and the card are covered in ConstituentOutreachPage.test.tsx.

const captured = vi.hoisted(() => ({
  onScheduled: null as null | (() => Promise<void>),
}))

vi.mock('app/dashboard/outreach/v2/sms/SmsFlow', () => ({
  SERVE_SMS_SURFACE: { isServe: true },
  SmsFlow: ({ onScheduled }: { onScheduled: () => Promise<void> }) => {
    captured.onScheduled = onScheduled
    return null
  },
}))

vi.mock('@shared/experiments/serveSmsFlag', () => ({
  SERVE_SMS_FLAG_KEY: 'serve-sms-outreach',
  useServeSmsFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

// The details drawer mounts unconditionally and needs one — same precedent as
// ConstituentOutreachPage.test.tsx.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

// Robocall, so the table renders a plain row and asks for no per-channel
// detail — the refresh is the only request these tests care about.
const seededRow: HistoryRow = {
  id: 1,
  date: '2026-08-20',
  outreachType: 'robocall',
  name: 'Budget update call',
  status: 'completed',
}

const refresh = async () => {
  expect(captured.onScheduled).not.toBeNull()
  let settled: unknown = 'never settled'
  // act, not a bare await: the success path sets state. A rejection would
  // propagate out of act and fail the test, which is the point.
  await act(async () => {
    settled = await captured.onScheduled!()
  })
  return settled
}

describe('ConstituentOutreachPage — the post-send history refresh', () => {
  beforeEach(() => {
    captured.onScheduled = null
  })

  it('settles and keeps the existing rows when the refresh answers non-2xx', async () => {
    api.mock('GET /v1/outreach/serve', {
      status: 404,
      data: { message: 'No elected office' },
    })

    render(<ConstituentOutreachPage outreaches={[seededRow]} />)

    expect(await refresh()).toBeUndefined()

    // Not cleared: a failed read is not an answer about what this org has
    // sent, so the rows already on screen stay.
    expect(
      within(desktopTable()).getByText('Budget update call'),
    ).toBeInTheDocument()
  })

  it('settles when the refresh fails at the network level', async () => {
    // No status to ignore here — ofetch rejects outright, which is what the
    // try/catch and not `ignoreResponseError` is for.
    mswServer.use(
      http.get('/api/v1/outreach/serve', () => HttpResponse.error()),
    )

    render(<ConstituentOutreachPage outreaches={[seededRow]} />)

    expect(await refresh()).toBeUndefined()

    expect(
      within(desktopTable()).getByText('Budget update call'),
    ).toBeInTheDocument()
  })

  it('replaces the rows when the refresh succeeds', async () => {
    api.mock('GET /v1/outreach/serve', {
      status: 200,
      data: [
        {
          id: 2,
          date: '2026-09-04',
          outreachType: 'text',
          name: 'Budget update texts',
          status: 'pending',
        },
      ],
    })

    render(<ConstituentOutreachPage outreaches={[seededRow]} />)

    await refresh()

    const table = within(desktopTable())
    expect(table.getByText('Budget update texts')).toBeInTheDocument()
    expect(table.queryByText('Budget update call')).not.toBeInTheDocument()
  })
})
