import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  createP2pPhoneList,
  getP2pPhoneListBuildStatus,
} from 'helpers/createP2pPhoneList'
import { SmsFlow } from './SmsFlow'

// gp-api's build-status route maps every non-2xx -- including a permanent
// 404 for a build row that is genuinely gone -- to `building` (see
// getP2pPhoneListBuildStatus), so a build that never resolves polls forever
// unless SmsFlow's LongPoll enforces its own ceiling. The real
// PHONE_LIST_BUILD_POLL_LIMIT is sized in minutes so it never cuts off a
// legitimately long async build; stubbed small here so this file doesn't
// have to wait out the real bound to prove the ceiling fires.
vi.mock('./smsPhoneListPollLimit', () => ({
  PHONE_LIST_BUILD_POLL_LIMIT: 3,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

vi.mock('app/(dashboard)/shared/dictation/useDictationAppend', () => ({
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

// Untyped clientFetch helpers, so module-mocked rather than MSW-mocked.
vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({
    ok: true,
    token: 'tok-1',
    buildId: 'build-1',
  })),
  getP2pPhoneListBuildStatus: vi.fn(async () => ({
    buildStatus: 'building',
  })),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    {
      id: 9,
      isPro: true,
      hasFreeTextsOffer: false,
      ownerName: 'Jane Doe',
      details: { normalizedOffice: 'City Council' },
    },
    vi.fn(),
  ],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'campaign-9', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 1, firstName: 'Jane' }, vi.fn(), false],
}))

const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

const dayName = (daysFromNow: number) => {
  const target = new Date(FROZEN_NOW)
  target.setDate(target.getDate() + daysFromNow)
  return new RegExp(
    `^${target.toLocaleDateString('en-US', { weekday: 'long' })}, ` +
      `${target.toLocaleDateString('en-US', { month: 'long' })} ` +
      `${target.getDate()}(?!\\d)`,
  )
}

const attachImage = async () => {
  const file = new File(['x'.repeat(100)], 'headshot.png', {
    type: 'image/png',
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, file)
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  vi.mocked(createP2pPhoneList).mockResolvedValue({
    ok: true,
    token: 'tok-1',
    buildId: 'build-1',
  })
  vi.mocked(getP2pPhoneListBuildStatus).mockResolvedValue({
    buildStatus: 'building',
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [{ id: 41, name: 'Likely voters' }],
  })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 1500, avgAge: null, avgIncome: null },
      reachability: {
        sms: 1200,
        robocall: null,
        phoneBanking: null,
        doorKnocking: null,
        polls: null,
      },
      outreachHistory: [],
    },
  })
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/campaigns/mine/recommended-lists', {
    status: 200,
    data: [],
  })
  api.mock('GET /v1/contacts/precincts', {
    status: 200,
    data: { options: [], truncated: false },
  })
  api.mock('GET /v1/outreach', { status: 200, data: [] })
  api.mock('POST /v1/outreach/sms/draft', ({ body }) => ({
    status: 200,
    data: { draft: `AI body (${body.tone}) for ${body.purpose}` },
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

// The bug this pins: SmsFlow's LongPoll had no `limit`, and
// getP2pPhoneListBuildStatus deliberately reads every non-2xx (a cleaned-up
// build row, a routing problem) as `building` rather than `failed` -- so a
// build gp-api never resolves polled forever with no way out. The fix gives
// the poll a generous but finite ceiling (PHONE_LIST_BUILD_POLL_LIMIT,
// stubbed to 3 above) and, once it's exhausted, surfaces the same
// build-failed retry card a `failed` response shows.
it('surfaces the build-failed retry card once the poll exhausts its ceiling, rather than polling forever', async () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      source="outreach_page"
      open
      onClose={onClose}
      onScheduled={onScheduled}
    />,
  )

  await userEvent.click(screen.getByText('Introduce myself to voters'))
  await userEvent.click(await screen.findByText('Choose a voter list'))
  await userEvent.click(await screen.findByText('Likely voters'))
  await userEvent.click(
    await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
  )
  await screen.findByText('When do you want to send it?')
  await userEvent.click(screen.getByText('Pick a date'))
  await userEvent.click(await screen.findByRole('button', { name: dayName(4) }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('textbox', { name: 'Message body' })
  await attachImage()
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  expect(
    await screen.findByText(
      "We couldn't prepare this audience. Try again.",
      {},
      { timeout: 8000 },
    ),
  ).toBeInTheDocument()
}, 10000)
