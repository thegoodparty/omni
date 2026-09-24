import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import {
  createP2pPhoneList,
  getP2pPhoneListStatus,
} from 'helpers/createP2pPhoneList'
import { createOutreach } from 'helpers/createOutreach'
import type { TcrCompliance } from 'helpers/types'
import { SERVE_SMS_SURFACE, SmsFlow } from './SmsFlow'
import {
  SERVE_SMS_GREETING_PREVIEW,
  SERVE_SMS_SAMPLE_FIRST_NAME,
} from './smsCompose.util'

// The Serve send path: everything SmsFlow does BELOW compose when the
// surface is Serve. The assertions that matter most here are the negative
// ones — that no Peerly phone list is derived, that no campaignId and no
// scheduledLocalTime reach the create — because those are what prove the
// flow's early-return guards actually route instead of falling through into
// the live Win sequence.

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

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

// Untyped clientFetch helpers, so module-mocked rather than MSW-mocked.
// Mocked to SUCCEED on purpose: a Serve run that accidentally reached them
// would otherwise fail for the wrong reason, and the point is to assert they
// were never reached at all.
vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({ ok: true, token: 'tok-1' })),
  getP2pPhoneListStatus: vi.fn(async () => ({
    phoneListId: 77,
    leadsLoaded: 1200,
    excludedOptedOutCount: 3,
    excludedDuplicatePhoneCount: 1,
  })),
}))

vi.mock('helpers/createOutreach', () => ({
  createOutreach: vi.fn(async () => ({ id: 55 })),
}))

const uploadFileToS3 = vi.fn(async () => 'https://assets.test/headshot.png')
vi.mock('@shared/utils/s3Upload', () => ({
  uploadFileToS3: (...args: unknown[]) => uploadFileToS3(...(args as [])),
}))

const createCheckoutSession = vi.fn(
  async (_type: string, _meta: Record<string, unknown>) => ({
    ok: true,
    // amount 0 keeps the review step on its free branch, which is the only
    // one that renders in jsdom (the paid card mounts real Stripe elements).
    // The checkout session is still created, which is what is under test.
    data: { id: 'cs_1', clientSecret: '', amount: 0 },
  }),
)
vi.mock('app/dashboard/purchase/utils/purchaseFetch.utils', () => ({
  createCheckoutSession: (type: string, meta: Record<string, unknown>) =>
    createCheckoutSession(type, meta),
  completeCheckoutSession: vi.fn(async () => ({ ok: true })),
  completeFreePurchase: vi.fn(async () => ({ ok: true })),
}))

// An elected official has no campaign row; a candidate does. Mutable so one
// file can prove both halves of "SERVE_TEXT on Serve, TEXT on Win".
const campaignState = vi.hoisted(() => ({
  campaign: null as Record<string, unknown> | null,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaignState.campaign, vi.fn()],
}))

// positionName is what the Serve identification sentence names the office
// from — deliberately carrying the " - District 3" suffix and the
// ungrammatical "City Council", so the test proves grammarizeOfficeName runs.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({
    slug: 'eo-jane-doe',
    district: {},
    positionName: 'City Council - District 3',
  }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Jane', lastName: 'Doe' },
    vi.fn(),
    false,
  ],
}))

const TCR_FIXTURE = {
  id: 'tcr-1',
  ein: '84-3917265',
  postalAddress: '1 Main St, Austin, TX 78634',
  committeeName: 'Friends of Jane',
  candidateName: 'Jane Doe',
  websiteDomain: '',
  filingUrl: 'https://example.org/filing',
  phone: '15551234567',
  email: 'jane@example.org',
  createdAt: new Date(),
  updatedAt: new Date(),
  campaignId: 1,
} satisfies TcrCompliance

// Tuesday, so the first day the Serve calendar leaves open (+3 => Friday the
// 4th) stays inside the month and its day number addresses one cell.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

const WIN_DAY = /^Saturday, September 5(?!\d)/

let isElectedOfficial = true

const attachImage = async () => {
  const file = new File(['x'.repeat(100)], 'headshot.png', {
    type: 'image/png',
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, file)
}

const openServeFlow = () => {
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      open
      onClose={vi.fn()}
      onScheduled={onScheduled}
      surface={SERVE_SMS_SURFACE}
    />,
  )
  return { onScheduled }
}

// Drives purpose -> audience -> schedule -> compose -> review on Serve.
// `withImage` defaults to true because Win's gate is the norm every other
// test here assumes; false exercises the Serve-only imageless path.
const runServeToReview = async ({ withImage = true } = {}) => {
  await userEvent.click(await screen.findByText('Explain a recent decision'))
  await userEvent.click(await screen.findByText('Choose a constituent list'))
  await userEvent.click(await screen.findByText('Northside residents'))
  await userEvent.click(
    await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText(/drafted body/)
  if (withImage) await attachImage()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('SmsFlow serve send path', () => {
  beforeEach(() => {
    campaignState.campaign = null
    isElectedOfficial = true
    createCheckoutSession.mockClear()
    uploadFileToS3.mockClear()
    vi.mocked(createP2pPhoneList).mockClear()
    vi.mocked(getP2pPhoneListStatus).mockClear()
    vi.mocked(createOutreach).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)

    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 41, name: 'Northside residents' }],
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
    api.mock('GET /v1/elected-office/current', () =>
      isElectedOfficial
        ? {
            status: 200,
            data: {
              id: 'eo-1',
              swornInDate: null,
              electedDate: null,
              termStartDate: null,
              termEndDate: null,
              termLengthDays: null,
              isActive: true,
              party: null,
              pledgedAt: null,
              onboardingCompletedAt: null,
              selfReported: true,
              onboardingStep: null,
              campaignId: null,
            },
          }
        : { status: 404, data: { message: 'No elected office' } },
    )
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    api.mock('POST /v1/outreach/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never derives a Peerly phone list and never uses the win create', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/outreach/serve/sms', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: {
          outreachId: 91,
          recipientCount: 1180,
          excludedOptedOutCount: 15,
          excludedDuplicateCount: 5,
        },
      }
    })
    openServeFlow()
    await runServeToReview()

    await waitFor(() => expect(bodies).toHaveLength(1))

    // The assertion the guards exist for. A Serve send has no Peerly
    // identity to send under, so the phone-list derivation must never run —
    // on the audience step, on the name step, or anywhere else.
    expect(createP2pPhoneList).not.toHaveBeenCalled()
    expect(getP2pPhoneListStatus).not.toHaveBeenCalled()
    // Win's campaign-scoped draft create likewise.
    expect(createOutreach).not.toHaveBeenCalled()
  })

  it('creates through the serve endpoint with no campaignId and no send time', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/outreach/serve/sms', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: {
          outreachId: 91,
          recipientCount: 1180,
          excludedOptedOutCount: 15,
          excludedDuplicateCount: 5,
        },
      }
    })
    openServeFlow()
    await runServeToReview()

    await waitFor(() => expect(bodies).toHaveLength(1))
    const body = bodies[0]!

    expect(body).toMatchObject({
      // A calendar day. The send hour is fixed at 11am local, so it is not
      // the client's to send.
      scheduledLocalDate: '2026-09-04',
      voterFileFilterId: 41,
      imageUrl: 'https://assets.test/headshot.png',
    })
    expect(body.message).toContain('{{first_name}}')
    expect(body.message).toContain('Reply STOP to opt out.')
    expect(body.name).toEqual(expect.stringContaining('Northside residents'))

    // The two Win-only fields, named explicitly: a Serve org has no campaign
    // row, and the 11am send hour is a constant rather than a choice.
    expect(body).not.toHaveProperty('campaignId')
    expect(body).not.toHaveProperty('scheduledLocalTime')
    expect(body).not.toHaveProperty('phoneListId')

    // Server-derived counts, not client ones: the pay step quotes what the
    // create came back with.
    expect(await screen.findByText('1,180')).toBeInTheDocument()
    expect(await screen.findByText('15')).toBeInTheDocument()
  })

  // The imageless Serve path, end to end. The compose gate opening is
  // asserted in serveSurface.test.tsx; this pins what the open gate
  // produces — a create with no imageUrl key at all, and no upload.
  it('creates without an imageUrl when no image was attached', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/outreach/serve/sms', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: {
          outreachId: 92,
          recipientCount: 1180,
          excludedOptedOutCount: 15,
          excludedDuplicateCount: 5,
        },
      }
    })
    openServeFlow()
    await runServeToReview({ withImage: false })

    await waitFor(() => expect(bodies).toHaveLength(1))
    const body = bodies[0]!
    // Absent, not null or empty string: the contract has imageUrl optional,
    // and a null would fail its url() check.
    expect(body).not.toHaveProperty('imageUrl')
    expect(body.voterFileFilterId).toBe(41)
    expect(uploadFileToS3).not.toHaveBeenCalled()
  })

  // The one screen that promises a preview used to show the raw merge
  // token. It now reads like the text a constituent receives — and the
  // create payload still carries the token, which is what fulfilment
  // merges against.
  it('previews with a stand-in name while the sent script keeps the token', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/outreach/serve/sms', ({ body }) => {
      bodies.push(body as unknown as Record<string, unknown>)
      return {
        status: 200,
        data: {
          outreachId: 91,
          recipientCount: 1180,
          excludedOptedOutCount: 0,
          excludedDuplicateCount: 0,
        },
      }
    })
    openServeFlow()
    await runServeToReview()

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]!.message).toContain('{{first_name}}')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Preview message' }),
    )
    expect(
      await screen.findByText(`Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`, {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/\{\{first_name\}\}/)).toBeNull()
    expect(
      screen.getByText(SERVE_SMS_GREETING_PREVIEW.caption),
    ).toBeInTheDocument()

    // Display-only: nothing re-sent, and the payload above is unchanged.
    expect(bodies).toHaveLength(1)
  })

  it('checks out as SERVE_TEXT', async () => {
    api.mock('POST /v1/outreach/serve/sms', {
      status: 200,
      data: {
        outreachId: 91,
        recipientCount: 1180,
        excludedOptedOutCount: 0,
        excludedDuplicateCount: 0,
      },
    })
    openServeFlow()
    await runServeToReview()

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalled())
    expect(createCheckoutSession).toHaveBeenCalledWith(
      'SERVE_TEXT',
      expect.objectContaining({
        outreachId: 91,
        contactCount: 1180,
        outreachType: 'text',
        campaignId: undefined,
        phoneListToken: undefined,
      }),
    )
  })

  it('surfaces a failed create instead of stranding the pay step', async () => {
    api.mock('POST /v1/outreach/serve/sms', {
      status: 500,
      data: { message: 'boom' },
    })
    openServeFlow()
    await runServeToReview()

    expect(
      await screen.findByText(
        /We couldn.t set up your purchase\. Go back a step and try again\./,
      ),
    ).toBeInTheDocument()
    // No checkout session is opened for a send that was never persisted.
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it('identifies the official by the office they hold, grammarized', async () => {
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // "City Council - District 3" -> "City Council Member": the district
    // suffix is dropped and the noun is made a person, by polls' own
    // grammarizeOfficeName rather than by anything re-derived here.
    expect(
      await screen.findByText(/this is Jane, your City Council Member\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/candidate for/)).toBeNull()
    expect(screen.queryByText(/District 3/)).toBeNull()

    // A second tone, to prove the wiring is tone-keyed and not a constant.
    // (All four are pinned in smsCompose.util.test.ts.)
    await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))
    expect(
      await screen.findByText(/Jane here, your City Council Member\./),
    ).toBeInTheDocument()
  })
})

// The other half of the checkout assertion, in the same file so the two
// cannot drift apart. Everything below compose on Win is untouched by this
// change; this pins the one line that had to learn a second value.
describe('SmsFlow win send path (unchanged)', () => {
  beforeEach(() => {
    campaignState.campaign = {
      id: 9,
      isPro: true,
      hasFreeTextsOffer: false,
      ownerName: 'Jane Doe',
      details: { normalizedOffice: 'City Council' },
    }
    isElectedOfficial = false
    createCheckoutSession.mockClear()
    vi.mocked(createP2pPhoneList).mockClear()
    vi.mocked(createOutreach).mockClear()
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
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    api.mock('POST /v1/outreach/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('still derives a phone list, creates via createOutreach, and checks out as TEXT', async () => {
    render(
      <SmsFlow
        open
        onClose={vi.fn()}
        onScheduled={vi.fn().mockResolvedValue(undefined)}
        tcrCompliance={TCR_FIXTURE}
      />,
    )

    await userEvent.click(await screen.findByText('Introduce myself to voters'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(await screen.findByRole('button', { name: WIN_DAY }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(/this is Jane, candidate for City Council\./),
    ).toBeInTheDocument()
    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalled())
    expect(createP2pPhoneList).toHaveBeenCalled()
    expect(createOutreach).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 9, scheduledLocalTime: '10:00' }),
      expect.anything(),
    )
    expect(createCheckoutSession).toHaveBeenCalledWith(
      'TEXT',
      expect.objectContaining({ outreachType: 'p2p', campaignId: 9 }),
    )
  })
})
