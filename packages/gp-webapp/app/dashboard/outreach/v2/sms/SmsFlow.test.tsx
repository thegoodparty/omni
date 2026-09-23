import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { OutreachDetail, SmsDraftRequest } from '@goodparty_org/contracts'
import { createOutreach } from 'helpers/createOutreach'
import { createOutreachDraft } from 'helpers/createOutreachDraft'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { SmsFlow, SuccessScreen } from './SmsFlow'
import type { OutreachGateState } from '../gate/useOutreachGate'
import { gateRef } from '../gate/testing/mockReactiveGate'
import type { TcrCompliance } from 'helpers/types'

// The gate's own flag/membership plumbing has its own tests; here the flow's
// wiring is what's under test, so the hook is driven directly through the
// shared reactive stand-in (see mockReactiveGate for why it is a module
// singleton rather than a hoisted ref).
vi.mock('../gate/useOutreachGate', async () => {
  const { useMockOutreachGate } =
    await import('../gate/testing/mockReactiveGate')
  return { useOutreachGate: useMockOutreachGate }
})

// Both mount real Stripe / filing surfaces; the flow only owns whether they
// are on screen.
vi.mock('app/dashboard/pro-upgrade/components/ProUpgradeFlow', () => ({
  // The completion is the candidate's Continue on the upgrade's success
  // screen — the one press the gate's own latch exists to keep reachable —
  // so the stand-in exposes it as a button. `onExit` is the wizard's own way
  // out, which is also what Back on its FIRST step calls.
  default: ({
    onComplete,
    onExit,
  }: {
    onComplete: () => void
    onExit: () => void
  }) => (
    <div data-testid="pro-upgrade-flow">
      <button type="button" onClick={onComplete}>
        Finish upgrade
      </button>
      <button type="button" onClick={onExit}>
        Finish later
      </button>
    </div>
  ),
}))
vi.mock(
  'app/dashboard/campaign-verification/components/CampaignVerificationSteps',
  () => ({ default: () => <div data-testid="campaign-verification" /> }),
)

vi.mock('helpers/createOutreachDraft', () => ({
  createOutreachDraft: vi.fn(async () => ({
    draft: { id: 77 } as OutreachDetail,
    conflictId: null,
  })),
}))

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
  async (
    _type: string,
    _meta: Record<string, unknown>,
  ): Promise<{
    ok: boolean
    data?: { statusCode: number; message: string }
  }> => ({ ok: true }),
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

const openFlow = () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      open
      onClose={onClose}
      onScheduled={onScheduled}
      tcrCompliance={TCR_FIXTURE}
    />,
  )
  return { onClose, onScheduled }
}

// Every scheduling assertion below is relative to "today", and the calendar
// day a test picks is addressed by its formatted name. Left on the real
// clock, both the month the target lands in and whether its day number is a
// prefix of another same-weekday day ("September 1" also matches "September
// 15") change from one day to the next. Freeze the date — Date only, so
// timers stay real for userEvent/waitFor — on a day where +4 stays inside
// the month and addresses exactly one day.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

// The picked day, addressed the way react-day-picker names its buttons
// ("Saturday, September 5th, 2026"). (?!\d) stops a single-digit day from
// also matching the two-digit days it prefixes.
const dayName = (daysFromNow: number) => {
  const target = new Date(FROZEN_NOW)
  target.setDate(target.getDate() + daysFromNow)
  return new RegExp(
    `^${target.toLocaleDateString('en-US', { weekday: 'long' })}, ` +
      `${target.toLocaleDateString('en-US', { month: 'long' })} ` +
      `${target.getDate()}(?!\\d)`,
  )
}

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

describe('SmsFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    gateRef.set({
      enabled: false,
      requirement: null,
      twoStep: true,
      membership: null,
      tcrCompliance: null,
    })
    vi.mocked(createOutreachDraft).mockResolvedValue({
      draft: { id: 77 } as OutreachDetail,
      conflictId: null,
    })
    mockLists()
    mockListDetail()
    // useOutreachAudience's useElectedOffice fires on mount; 404 => not an
    // elected official, exercising the hook's real 404->null branch.
    api.mock('GET /v1/elected-office/current', {
      status: 404,
      data: { message: 'No elected office' },
    })
    // The picker always asks for recommendations now; this file's cases are
    // about the flow, not the cards, so answer with none.
    api.mock('GET /v1/campaigns/mine/recommended-lists', {
      status: 200,
      data: [],
    })
    // Answered so it never reaches the network. Left unhandled it passes
    // through, fails, and retries on a ~1s backoff, re-rendering the builder
    // partway through a test. Precinct itself is covered by PrecinctFilter
    // and usePrecinctOptions.
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    mockOutreachList()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    await userEvent.click(screen.getByText('Introduce myself to voters'))

    // Audience: auto-filter hides the auto-generated list.
    expect(
      (await screen.findAllByText('Who do you want to reach?')).length,
    ).toBeGreaterThan(0)
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

    // Schedule: a date 4 days out clears the 48-hour floor.
    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
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
    expect(
      screen.getByText(/Paid for by Friends of Jane\./),
    ).toBeInTheDocument()

    // Continue blocked until the required image is attached.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Review: free-texts offer covers 1,200 → free branch.
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Review and send' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('1,200')).toBeInTheDocument()
    const scheduleButton = await screen.findByRole('button', {
      name: 'Schedule campaign',
    })
    await userEvent.click(scheduleButton)

    await waitFor(() =>
      expect(screen.getByText('Scheduled!')).toBeInTheDocument(),
    )
    // The draft create carries the picked wall-clock time (default 10 AM
    // slot) — approve opens Peerly's contact-local window at it.
    expect(vi.mocked(createOutreach)).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledLocalTime: '10:00' }),
      expect.anything(),
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

  // The hub's `?compose=text` deep link seeds these. A preset message is one
  // the candidate is meant to send as written (Know Your Opponent), so the
  // flow opens on `custom` — the purpose that never AI-drafts — past the
  // picker, rather than asking a question whose answer would draft over it.
  describe('deep-link seeds', () => {
    const openSeeded = (
      props: Partial<{
        initialScript: string
        preselectedListId: number
        campaignPlanDueDate: string
      }>,
    ) =>
      render(
        <SmsFlow
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
          tcrCompliance={TCR_FIXTURE}
          {...props}
        />,
      )

    it('opens past the purpose picker with a seeded message', async () => {
      openSeeded({ initialScript: 'Hello {first_name}, vote Tuesday.' })

      expect(
        (await screen.findAllByText('Who do you want to reach?')).length,
      ).toBeGreaterThan(0)
      expect(
        screen.queryByText('Introduce myself to voters'),
      ).not.toBeInTheDocument()
    })

    it('opens on the purpose picker with no seed', async () => {
      openSeeded({})

      expect(
        await screen.findByText('Introduce myself to voters'),
      ).toBeInTheDocument()
    })

    it('selects a preselected list once the picker rows arrive', async () => {
      openSeeded({
        initialScript: 'Hello {first_name}, vote Tuesday.',
        preselectedListId: 41,
      })

      // The audience step reads back the selected list by name rather than
      // leaving the picker on its placeholder.
      expect(await screen.findByText(/Likely voters/)).toBeInTheDocument()
    })

    it('ignores a preselected list that names no row of yours', async () => {
      openSeeded({
        initialScript: 'Hello {first_name}, vote Tuesday.',
        preselectedListId: 9999,
      })

      expect(await screen.findByText('Choose a voter list')).toBeInTheDocument()
    })
  })

  it('shows the server message when the free purchase is rejected as a 400', async () => {
    mockDraft()
    const rejectionMessage =
      'Message cannot contain tinyurl.com links. Please correct your message.'
    completeFreePurchase.mockResolvedValueOnce({
      ok: false,
      data: { statusCode: 400, message: rejectionMessage },
    })
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
    )

    expect(
      await screen.findByText('When do you want to send it?'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(/AI body \(warm\) for introduce_myself/),
    ).toBeInTheDocument()
    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const scheduleButton = await screen.findByRole('button', {
      name: 'Schedule campaign',
    })
    await userEvent.click(scheduleButton)

    expect(await screen.findByText(rejectionMessage)).toBeInTheDocument()
    expect(screen.queryByText('Scheduled!')).not.toBeInTheDocument()
  })

  it('builds a new list in-flow and continues into scheduling', async () => {
    mockDraft()
    api.mock('POST /v1/contacts/count', { status: 200, data: { count: 875 } })
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => ({
      status: 200,
      data: { id: 77, name: (body as { name: string }).name },
    }))
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
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
    expect(
      (await screen.findAllByText('Who do you want to reach?')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  describe('pro gate and drafts', () => {
    const GATE_LINE = 'Two things are needed before this text can send.'

    // The free build path's only audience. Both Pro-gated voter-file reads
    // (the builder's count and a saved list's reach count) 403 for this
    // candidate, so the recommendation card — which carries its own count —
    // is what the step offers and what the summary prices off.
    const RECOMMENDATION = {
      variant: 'persuadeAffinity' as const,
      intent: 'persuade' as const,
      filter: { independentAffinity: true },
      count: 900,
      copy: {
        title: 'Persuadable independents',
        criteriaSummary: 'Moderate to high propensity voters',
      },
      existingFilterId: 41,
    }

    // The same card before it has ever been saved: the candidate names it,
    // the flow creates the list, and the count has to survive that.
    const NEW_RECOMMENDATION = {
      ...RECOMMENDATION,
      variant: 'persuadeUndecided' as const,
      copy: {
        title: 'Undecided persuadables',
        criteriaSummary: 'Undecided voters',
      },
      existingFilterId: null,
    }

    // Truthful for a free campaign: gp-api refuses list-detail without Pro.
    const mockFreeAudience = () => {
      let listDetailCalls = 0
      api.mock('GET /v1/contacts/list-detail', () => {
        listDetailCalls += 1
        return { status: 403, data: { message: 'Pro subscription required' } }
      })
      api.mock('GET /v1/campaigns/mine/recommended-lists', {
        status: 200,
        data: [RECOMMENDATION],
      })
      return () => listDetailCalls
    }

    const FREE_GATE: OutreachGateState = {
      enabled: true,
      requirement: 'pro',
      twoStep: true,
      membership: {
        tier: 'free',
        texting: 'needs_verification',
        pinDelivery: null,
        isElectedOffice: false,
      },
      tcrCompliance: null,
    }

    const CLEARED_GATE: OutreachGateState = {
      enabled: true,
      requirement: null,
      twoStep: true,
      membership: {
        tier: 'pro',
        texting: 'cleared',
        pinDelivery: null,
        isElectedOffice: false,
      },
      tcrCompliance: null,
    }

    const DRAFT_SCRIPT =
      'Hello, this is Jane, candidate for City Council. Vote Tuesday.\n\n' +
      'Paid for by Friends of Jane.\nReply STOP to opt out.'

    const draftDetail = (
      overrides: Partial<OutreachDetail> = {},
    ): OutreachDetail => ({
      id: 88,
      createdAt: new Date('2026-08-20T12:00:00Z'),
      updatedAt: new Date('2026-08-20T12:00:00Z'),
      campaignId: 9,
      outreachType: 'p2p',
      projectId: null,
      name: 'Likely voters — SMS',
      status: 'draft',
      error: null,
      audienceRequest: null,
      script: DRAFT_SCRIPT,
      message: null,
      date: null,
      imageUrl: 'https://assets.example.org/draft.png',
      voterFileFilterId: 41,
      doorKnockingRouteId: null,
      phoneListId: null,
      identityId: null,
      didState: null,
      didNpaSubset: [],
      title: null,
      textCount: null,
      billableTextCount: null,
      campaignPlanDueDate: null,
      organizationSlug: 'campaign-9',
      archivedAt: null,
      ...overrides,
    })

    // A free build has no date to pick and nothing to review: purpose →
    // audience → compose → the campaign name, which is where the draft is
    // written (design: the locked "when" step).
    const buildToName = async () => {
      await userEvent.click(screen.getByText('Introduce myself to voters'))
      // Recommendations only: the picker offers no saved lists here.
      expect(screen.queryByText('Choose a voter list')).not.toBeInTheDocument()
      await userEvent.click(await screen.findByText('Persuadable independents'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(900\)/ }),
      )
      expect(
        await screen.findByText(/AI body \(warm\) for introduce_myself/),
      ).toBeInTheDocument()
      await attachImage()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: 'What do you want to call this campaign?',
        }),
      ).toBeInTheDocument()
    }

    // The name step's Continue is the draft save for a free tier: the Pro
    // gate opens off it (design: flowContinue on the locked "when" step).
    const saveDraft = () =>
      userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The whole free build path, with every Pro-gated read answering the way
    // gp-api really answers it: nothing asks list-detail for a count, and
    // the name step only asks for the name.
    it('reaches the name step without a list-detail read', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      const listDetailCalls = mockFreeAudience()
      openFlow()

      await buildToName()

      expect(screen.getByLabelText('Campaign name')).toHaveValue(
        'Likely voters — SMS',
      )
      expect(screen.queryByText('Send date')).not.toBeInTheDocument()
      expect(screen.queryByText('Review and verify')).not.toBeInTheDocument()
      expect(listDetailCalls()).toBe(0)
    })

    // The FIRST time a recommendation is taken there is no saved list yet, so
    // it goes through createRecommendedList rather than the reuse branch,
    // and the build has to land on the name step off that list.
    it('saves a recommendation taken for the first time and reaches the name step', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      const listDetailCalls = mockFreeAudience()
      api.mock('GET /v1/campaigns/mine/recommended-lists', {
        status: 200,
        data: [NEW_RECOMMENDATION],
      })
      api.mock('POST /v1/voters/voter-file/filter', {
        status: 200,
        data: { id: 71, name: 'Undecided persuadables' },
      })
      openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      // A card with no saved list behind it opens the naming drawer, and its
      // Continue is what creates the list.
      await userEvent.click(await screen.findByText('Undecided persuadables'))
      expect(await screen.findByLabelText('List name')).toHaveValue(
        'Undecided persuadables',
      )
      await userEvent.click(
        await screen.findByRole('button', { name: 'Continue' }),
      )
      expect(
        await screen.findByText(/AI body \(warm\) for introduce_myself/),
      ).toBeInTheDocument()
      await attachImage()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: 'What do you want to call this campaign?',
        }),
      ).toBeInTheDocument()
      // The saved-lists mock never returns the row the create just made, so
      // the auto-name falls back to the channel; the field being filled is
      // what matters here.
      expect(
        (screen.getByLabelText('Campaign name') as HTMLInputElement).value,
      ).toMatch(/ — SMS$/)
      expect(listDetailCalls()).toBe(0)
    })

    // The banner's gate opens the wizard on its first step, whose Back is the
    // wizard's own exit. Wired straight to onClose it shut the sheet on a
    // candidate who had only wanted to read what Pro was.
    it('keeps the build when Back is pressed on the banner-opened gate', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      const { onClose } = openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Persuadable independents'))

      await userEvent.click(screen.getByText(GATE_LINE))
      await userEvent.click(
        await screen.findByRole('button', { name: 'Join Pro' }),
      )
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Finish later' }),
      )

      expect(
        await screen.findByText('Persuadable independents'),
      ).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    // The other half of the rule: with a row saved, Finish later still means
    // what it always did — the draft is safe in history, so the sheet closes.
    it('closes the sheet on Finish later once a draft is saved', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      const { onClose } = openFlow()

      await buildToName()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      await userEvent.click(
        screen.getByRole('button', { name: 'Finish later' }),
      )

      expect(onClose).toHaveBeenCalled()
    })

    it('saves the text as a draft and opens the Pro interstitial', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      const { onScheduled } = openFlow()

      expect(await screen.findByText(GATE_LINE)).toBeInTheDocument()
      await buildToName()
      await saveDraft()

      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      expect(vi.mocked(createOutreachDraft)).toHaveBeenCalledWith(
        expect.objectContaining({
          outreachType: 'p2p',
          name: 'Likely voters — SMS',
          voterFileFilterId: 41,
          script: expect.stringContaining('Paid for by Friends of Jane.'),
        }),
        expect.any(File),
      )
      expect(onScheduled).toHaveBeenCalledTimes(1)
    })

    it('switches into resume mode when a draft already exists', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      vi.mocked(createOutreachDraft).mockResolvedValue({
        draft: null,
        conflictId: 55,
      })
      const detailRequests: string[] = []
      api.mock('GET /v1/outreach/:id', ({ params }) => {
        detailRequests.push(params.id)
        return { status: 200, data: draftDetail({ id: 55 }) }
      })
      openFlow()

      await buildToName()
      await saveDraft()

      await waitFor(() => expect(detailRequests).toEqual(['55']))
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      // The flow is now working the existing row, not the one it tried to
      // write.
      expect(screen.queryByText('Review and verify')).not.toBeInTheDocument()
    })

    // The requirement clears while the upgrade's own success screen is
    // still up. The gate must stay put until the candidate presses Continue
    // there, and then land them on the schedule step: a resumed row has no
    // send date, and review is the checkout step.
    it('lands the 409 resume on the schedule step once the upgrade completes', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      vi.mocked(createOutreachDraft).mockResolvedValue({
        draft: null,
        conflictId: 55,
      })
      api.mock('GET /v1/outreach/:id', {
        status: 200,
        data: draftDetail({ id: 55 }),
      })
      openFlow()

      await buildToName()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')
      vi.mocked(createOutreach).mockClear()

      act(() => gateRef.set(CLEARED_GATE))

      // Still on the upgrade's success screen, not dumped back into the flow.
      expect(screen.getByTestId('pro-upgrade-flow')).toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Finish upgrade' }),
      )

      expect(
        await screen.findByText('When do you want to send it?'),
      ).toBeInTheDocument()
      // Review is the checkout step: reaching it with no date would create
      // the pending_payment draft off a row that has none.
      expect(vi.mocked(createOutreach)).not.toHaveBeenCalled()
    })

    // The flow stays mounted between opens, so the gate has to re-open on
    // every open of a resumed draft — the second tile click used to land on
    // the schedule step of a text the candidate cannot send.
    it('re-opens the gate every time a resumed draft is opened', async () => {
      gateRef.set(FREE_GATE)
      mockFreeAudience()
      const props = {
        onClose: vi.fn(),
        onScheduled: vi.fn().mockResolvedValue(undefined),
        tcrCompliance: TCR_FIXTURE,
        resumeDraft: draftDetail(),
      }
      const { rerender } = render(<SmsFlow open {...props} />)
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      rerender(<SmsFlow open={false} {...props} />)
      rerender(<SmsFlow open {...props} />)

      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      expect(
        screen.queryByText('When do you want to send it?'),
      ).not.toBeInTheDocument()
    })

    it('opens a cleared draft at the schedule step and converts it', async () => {
      gateRef.set(CLEARED_GATE)
      render(
        <SmsFlow
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
          tcrCompliance={TCR_FIXTURE}
          resumeDraft={draftDetail()}
        />,
      )

      expect(
        await screen.findByText('When do you want to send it?'),
      ).toBeInTheDocument()
      expect(screen.queryByText(GATE_LINE)).not.toBeInTheDocument()
      // Purpose, audience and compose are settled; compose could never
      // advance again, so there is nowhere to go back to.
      expect(
        screen.queryByRole('button', { name: 'Back' }),
      ).not.toBeInTheDocument()
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() =>
        expect(vi.mocked(createOutreach)).toHaveBeenCalledWith(
          expect.objectContaining({
            draftOutreachId: 88,
            script: DRAFT_SCRIPT,
            voterFileFilterId: 41,
            phoneListId: 77,
          }),
          null,
        ),
      )
      expect(
        screen.queryByRole('button', { name: 'Back' }),
      ).not.toBeInTheDocument()
    })

    it('blocks the resume when the draft list is gone', async () => {
      gateRef.set(CLEARED_GATE)
      api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
      render(
        <SmsFlow
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
          tcrCompliance={TCR_FIXTURE}
          resumeDraft={draftDetail()}
        />,
      )

      expect(
        await screen.findByText(
          'The voter list for this text is no longer available.',
        ),
      ).toBeInTheDocument()
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    // The row is already gone once DELETE returns, so a history refetch that
    // fails afterwards must still close the sheet instead of leaving the
    // candidate on a spinner over a draft that no longer exists.
    // A 201 means the draft exists; the hub refetch that follows is a
    // courtesy, so its failure must neither surface as a save error nor keep
    // the gate from opening.
    it('opens the gate after a save even when the history refetch fails', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      const { onScheduled } = openFlow()
      onScheduled.mockRejectedValueOnce(new Error('refetch failed'))

      await buildToName()
      await saveDraft()

      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      expect(onScheduled).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByText("We couldn't save this draft. Try again."),
      ).not.toBeInTheDocument()
    })

    // Free tier loses the in-flow builder, and the custom purpose asks for
    // no recommendations: with no saved lists either there is nothing to
    // pick, so the step has to say what to do instead of sitting on a
    // disabled Continue.
    it('offers a way out when a free candidate has nothing to pick', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
      openFlow()

      await userEvent.click(screen.getByText('Write my own message'))

      expect(
        await screen.findByText(
          'Pick a purpose to see recommended voter lists.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText('Choose a voter list')).not.toBeInTheDocument()
      await userEvent.click(
        screen.getByRole('button', { name: 'Choose a purpose' }),
      )

      expect(
        await screen.findByText('Introduce myself to voters'),
      ).toBeInTheDocument()
    })

    it('keeps the builder for an ungated elected official', async () => {
      gateRef.set({
        enabled: true,
        requirement: null,
        twoStep: true,
        membership: {
          tier: 'free',
          texting: 'cleared',
          pinDelivery: null,
          isElectedOffice: true,
        },
        tcrCompliance: null,
      })
      mockDraft()
      openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Choose a voter list'))

      expect(await screen.findByText('Create a new list')).toBeInTheDocument()
    })

    it('reports the saved draft', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      openFlow()

      await buildToName()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      expect(vi.mocked(trackEvent)).toHaveBeenCalledWith(
        EVENTS.Outreach.Draft.Saved,
        { channel: 'sms' },
      )
    })

    // A 409 wrote nothing — the campaign already had the row — so it is not
    // a save.
    it('reports no save when the draft already existed', async () => {
      vi.mocked(trackEvent).mockClear()
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      vi.mocked(createOutreachDraft).mockResolvedValue({
        draft: null,
        conflictId: 55,
      })
      api.mock('GET /v1/outreach/:id', {
        status: 200,
        data: draftDetail({ id: 55 }),
      })
      openFlow()

      await buildToName()
      await saveDraft()
      await screen.findByTestId('pro-upgrade-flow')

      expect(vi.mocked(trackEvent)).not.toHaveBeenCalledWith(
        EVENTS.Outreach.Draft.Saved,
        expect.anything(),
      )
    })

    // The banner rides every build-mode step, so its explainer can open the
    // gate long before there is a draft. Finishing there must hand the
    // candidate back the step they were on — landing them on schedule would
    // throw away purpose, audience and message the moment they paid.
    it('keeps the build intact when the upgrade starts from the banner', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      vi.mocked(createOutreachDraft).mockClear()
      openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Persuadable independents'))

      await userEvent.click(screen.getByText(GATE_LINE))
      await userEvent.click(
        await screen.findByRole('button', { name: 'Join Pro' }),
      )
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      act(() => gateRef.set(CLEARED_GATE))
      await userEvent.click(
        screen.getByRole('button', { name: 'Finish upgrade' }),
      )

      // Back on the audience step with the audience still picked, not dropped
      // on schedule against a draft that was never written.
      expect(
        await screen.findByText('Persuadable independents'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('When do you want to send it?'),
      ).not.toBeInTheDocument()
      expect(vi.mocked(createOutreachDraft)).not.toHaveBeenCalled()
    })

    it('renders no banner and keeps the schedule step with the flag off', async () => {
      mockDraft()
      openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
      )

      expect(
        await screen.findByText('When do you want to send it?'),
      ).toBeInTheDocument()
      expect(screen.queryByText(GATE_LINE)).not.toBeInTheDocument()
    })
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
