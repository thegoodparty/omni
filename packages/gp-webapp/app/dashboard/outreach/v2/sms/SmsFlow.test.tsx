import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { SmsDraftRequest } from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import { router } from 'helpers/test-utils/router-mocking'
import { SmsFlow, SuccessScreen } from './SmsFlow'

// A cleared (VERIFIED) compliance keeps the default flow on the 48-hour
// scheduling floor; the verification-pending test omits it to exercise
// the 14-day floor.
const verifiedCompliance = {
  peerlyCvStatus: 'VERIFIED',
} as TcrCompliance

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

// The p2p phone-list helpers use the untyped clientFetch/apiRoutes path, so
// they are module-mocked rather than MSW-mocked.
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

const completeFreePurchase = vi.fn(
  async (_type: string, _meta: Record<string, unknown>) => ({ ok: true }),
)
vi.mock('app/dashboard/purchase/utils/purchaseFetch.utils', () => ({
  createCheckoutSession: vi.fn(async () => ({
    ok: true,
    data: { id: 'free_1', clientSecret: '', amount: 0 },
  })),
  completeCheckoutSession: vi.fn(async () => ({ ok: true })),
  completeFreePurchase: (type: string, meta: Record<string, unknown>) =>
    completeFreePurchase(type, meta),
}))

// The flow reads campaign (details/office, free-texts offer) and user (first
// name) from their providers; both are context-mocked at the hook level.
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    {
      id: 9,
      isPro: true,
      hasFreeTextsOffer: true,
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

const mockLists = () =>
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [
      { id: 41, name: 'Likely voters' },
      { id: 42, name: 'Text outreach — Aug 1, 2026' },
    ],
  })

const mockListDetail = () =>
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

const mockDraft = () => {
  const calls: SmsDraftRequest[] = []
  api.mock('POST /v1/outreach/sms/draft', ({ body }) => {
    calls.push(body)
    return {
      status: 200,
      data: { draft: `AI body (${body.tone}) for ${body.purpose}` },
    }
  })
  return calls
}

const mockOutreachList = () =>
  api.mock('GET /v1/outreach', { status: 200, data: [] })

const attachImage = async () => {
  const file = new File(['x'.repeat(100)], 'headshot.png', {
    type: 'image/png',
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, file)
}

// null = render with NO compliance record (verification pending); the
// explicit sentinel avoids the default-parameter trap where a passed
// undefined silently becomes verifiedCompliance.
const openFlow = (tcrCompliance: TcrCompliance | null = verifiedCompliance) => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      open
      onClose={onClose}
      tcrCompliance={tcrCompliance ?? undefined}
      onScheduled={onScheduled}
    />,
  )
  return { onClose, onScheduled }
}

describe('SmsFlow', () => {
  beforeEach(() => {
    mockLists()
    mockListDetail()
    // useOutreachAudience's useElectedOffice fires on mount; 404 => not an
    // elected official, exercising the hook's real 404->null branch.
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
    mockOutreachList()
  })

  it('shows the persistent compliance banner while verification is pending and routes Start compliance', async () => {
    const { onClose } = openFlow(null)

    expect(
      screen.getByText('Compliance needed before this can send'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Carrier approval takes 1 to 2 weeks/),
    ).toBeInTheDocument()

    // No TCR record → the election-filing entry, per ComplianceModal.
    await userEvent.click(
      screen.getByRole('button', { name: 'Start compliance' }),
    )
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/profile/texting-compliance/election-filing',
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('hides the compliance banner once verification has cleared', () => {
    openFlow()

    expect(
      screen.queryByText('Compliance needed before this can send'),
    ).not.toBeInTheDocument()
  })

  it('pushes the earliest send to 14 days while verification is pending', async () => {
    mockDraft()
    openFlow(null)

    await userEvent.click(screen.getByText('Introduce myself'))
    expect(await screen.findByText('Who are you texting?')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
    )

    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Earliest send while compliance is pending/),
    ).toBeInTheDocument()

    // Design parity: a date 4 days out clears the hard 48h calendar floor,
    // so it stays SELECTABLE — picking it surfaces the compliance alert and
    // blocks Continue instead of disabling the day outright.
    const target = new Date()
    target.setDate(target.getDate() + 4)
    await userEvent.click(screen.getByText('Pick a date'))
    const dayButton = await screen.findByRole('button', {
      name: new RegExp(
        `^${target.toLocaleDateString('en-US', { weekday: 'long' })}, ${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}`,
      ),
    })
    expect(dayButton).toBeEnabled()
    await userEvent.click(dayButton)
    expect(
      await screen.findByText(
        /Texting needs Pro plus carrier compliance approval/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('runs purpose → audience → schedule → compose → review and schedules free', async () => {
    const draftCalls = mockDraft()
    let receiptCalls = 0
    api.mock('GET /v1/outreach/:id/receipt', () => {
      receiptCalls += 1
      return { status: 404, data: { message: 'No receipt' } }
    })
    const { onScheduled } = openFlow()

    // Purpose
    await userEvent.click(screen.getByText('Introduce myself'))

    // Audience: auto-filter hides the auto-generated list.
    expect(await screen.findByText('Who are you texting?')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Choose a voter list'))
    expect(
      screen.queryByText('Text outreach — Aug 1, 2026'),
    ).not.toBeInTheDocument()
    await userEvent.click(await screen.findByText('Likely voters'))
    expect(
      await screen.findByText(/Message 1,200 voters for \$42\.00/),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Continue \(1,200\)/ }),
    )

    // Schedule: pick the earliest allowed date via the calendar is fiddly in
    // jsdom; type a custom time path instead by picking a date 4 days out.
    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
    const target = new Date()
    target.setDate(target.getDate() + 4)
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(
          `^${target.toLocaleDateString('en-US', { weekday: 'long' })}, ${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}`,
        ),
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Compose: initial AI draft fires; body arrives with the intro region.
    expect(
      await screen.findByText(/AI body \(warm\) for introduce_myself/),
    ).toBeInTheDocument()
    expect(draftCalls).toHaveLength(1)
    expect(
      screen.getByText(/this is Jane, candidate for City Council\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Reply STOP to opt out.')).toBeInTheDocument()

    // Continue blocked until the required image is attached.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Review: free-texts offer covers 1,200 → free branch.
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Review & pay' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('1,200')).toBeInTheDocument()
    const scheduleButton = await screen.findByRole('button', {
      name: 'Pay $0.00',
    })
    await userEvent.click(scheduleButton)

    await waitFor(() =>
      expect(screen.getByText('Payment successful!')).toBeInTheDocument(),
    )
    expect(completeFreePurchase).toHaveBeenCalledWith(
      'TEXT',
      expect.objectContaining({ outreachId: 55, phoneListToken: 'tok-1' }),
    )
    expect(onScheduled).toHaveBeenCalledTimes(1)

    // Free path: design subtitle, but no receipt — there is no charge, and
    // the endpoint must never be called (it would 404 the free row).
    expect(
      screen.getByText(
        /Your sms campaign will reach 1,200 recipients starting/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Receipt')).not.toBeInTheDocument()
    expect(receiptCalls).toBe(0)
  })

  it('builds a new list in-flow and continues into scheduling', async () => {
    mockDraft()
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 875 } })
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => ({
      status: 200,
      data: { id: 77, name: (body as { name: string }).name },
    }))
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Create a new list'))

    // Builder: CRM wizard pills; continue stays disabled until a selection.
    expect(await screen.findByText('Build a voter list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Super' }))

    // Debounced count settles into the CTA label.
    const continueWithCount = await screen.findByRole(
      'button',
      { name: 'Continue (875)' },
      { timeout: 3000 },
    )
    await userEvent.click(continueWithCount)

    // Name step: live count sentence + name input gate.
    expect(await screen.findByText('Name your list')).toBeInTheDocument()
    expect(screen.getByText(/875 voters match/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('List name'), 'Super voters TX')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Created + phone list derived (mocked) → schedule step.
    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
  })

  it('keeps Continue disabled on the audience step until a list is picked', async () => {
    mockDraft()
    openFlow()
    await userEvent.click(screen.getByText('Persuade likely voters'))
    expect(await screen.findByText('Who are you texting?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('routes Done into the verification interstitial while clearance pends', async () => {
    mockDraft()
    const { onClose } = openFlow(null)

    await userEvent.click(screen.getByText('Introduce myself'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
    )

    // The 14-day compliance floor: pick a date 16 days out, paging the
    // calendar when the target lands in the next month.
    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
    const target = new Date()
    target.setDate(target.getDate() + 16)
    await userEvent.click(screen.getByText('Pick a date'))
    if (target.getMonth() !== new Date().getMonth()) {
      await userEvent.click(
        await screen.findByRole('button', { name: /next month/i }),
      )
    }
    await userEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(
          `^${target.toLocaleDateString('en-US', { weekday: 'long' })}, ${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}`,
        ),
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText(/AI body \(warm\) for introduce_myself/)
    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay $0.00' }),
    )
    await waitFor(() =>
      expect(screen.getByText('Payment successful!')).toBeInTheDocument(),
    )

    // Done swaps the sheet body to the interstitial instead of closing.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByText('One more step before this can send'),
    ).toBeInTheDocument()
    expect(screen.getByText('What we need')).toBeInTheDocument()
    expect(screen.getByText('How long it takes')).toBeInTheDocument()
    expect(screen.getByText('Nothing is lost')).toBeInTheDocument()
    expect(screen.getByText('Start now if you can')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument()

    // No TCR record → the election-filing entry, per ComplianceModal.
    await userEvent.click(
      screen.getByRole('button', { name: 'Start verification' }),
    )
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/profile/texting-compliance/election-filing',
    )
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SuccessScreen receipt', () => {
  // The paid branch is unreachable through the flow in jsdom (CheckoutPayment
  // mounts real Stripe elements), so the receipt renders from a direct mount.
  it('renders the Stripe receipt for a paid send and opens the hosted copy', async () => {
    api.mock('GET /v1/outreach/:id/receipt', {
      status: 200,
      data: {
        amount: 42,
        cardBrand: 'visa',
        cardLast4: '4242',
        receiptUrl: 'https://pay.stripe.com/receipts/rcpt_1',
        paidAt: '2026-08-24T12:00:00.000Z',
      },
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <SuccessScreen
        contactCount={1200}
        sendAt={new Date('2026-09-08T10:00:00')}
        outreachId={55}
        paid
        onDone={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/starting Tue, Sep 8, 2026 at 10:00 AM\./),
    ).toBeInTheDocument()
    expect(await screen.findByText('Receipt')).toBeInTheDocument()
    expect(
      screen.getByText('SMS campaign, 1,200 recipients'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('$42.00')).toHaveLength(2)
    expect(screen.getByText('Cost per outreach')).toBeInTheDocument()
    expect(screen.getByText('$0.035')).toBeInTheDocument()
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument()
    expect(screen.getByText('Charged today')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Download receipt' }),
    )
    expect(open).toHaveBeenCalledWith(
      'https://pay.stripe.com/receipts/rcpt_1',
      '_blank',
      'noopener',
    )
    open.mockRestore()
  })
})
