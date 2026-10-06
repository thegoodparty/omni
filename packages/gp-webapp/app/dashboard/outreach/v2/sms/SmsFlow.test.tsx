import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { OutreachDetail, SmsDraftRequest } from '@goodparty_org/contracts'
import { createOutreach } from 'helpers/createOutreach'
import { createOutreachDraft } from 'helpers/createOutreachDraft'
import {
  createP2pPhoneList,
  getP2pPhoneListBuildStatus,
} from 'helpers/createP2pPhoneList'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { SmsFlow, SuccessScreen } from './SmsFlow'
import type { OutreachGateState } from '../gate/useOutreachGate'
import { gateRef } from '../gate/testing/mockReactiveGate'
import { SMS_GREETING_PREVIEW, SMS_GREETING } from './smsCompose.util'
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
  createP2pPhoneList: vi.fn(async () => ({
    ok: true,
    token: 'tok-1',
    buildId: 'build-1',
  })),
  getP2pPhoneListBuildStatus: vi.fn(async () => ({
    buildStatus: 'ready',
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

// The flow reads campaign (details/office, free-texts offer, ownerName) and
// user (first name) from their providers; both are context-mocked at the
// hook level. The campaign is a mutable ref so the team-member case can swap
// ownerName; the base is the owner-composing shape (session user Jane IS the
// owner), matching the real GET /v1/campaigns/mine payload.
const campaignState = vi.hoisted(() => {
  const base = () => ({
    id: 9,
    isPro: true,
    hasFreeTextsOffer: true,
    ownerName: 'Jane Doe',
    positionName: undefined as string | undefined,
    details: { normalizedOffice: 'City Council' } as {
      normalizedOffice?: string
    },
  })
  return { base, campaign: base() }
})
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaignState.campaign, vi.fn()],
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
      source="outreach_page"
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
    campaignState.campaign = campaignState.base()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    gateRef.set({
      enabled: false,
      resolved: true,
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
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/this is Jane, candidate for City Council\./),
    )
    expect(
      screen.getByRole('textbox', { name: 'Message body' }),
    ).toHaveTextContent(/Paid for by Friends of Jane\./)

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
    // slot) in the CAMPAIGN's zone — Eastern here, no state on the mocked
    // campaign — not the machine's: approve opens Peerly's window at it in
    // that same zone, so the offset must be Eastern whatever TZ runs this.
    expect(vi.mocked(createOutreach)).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledLocalTime: '10:00',
        date: expect.stringMatching(/T10:00:00-0[45]:00$/),
      }),
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

  describe('event invite details', () => {
    const fillEventDetails = (date: string, time: string, location: string) => {
      fireEvent.change(screen.getByLabelText('Date'), {
        target: { value: date },
      })
      fireEvent.change(screen.getByLabelText('Start time'), {
        target: { value: time },
      })
      fireEvent.change(screen.getByLabelText('Location'), {
        target: { value: location },
      })
    }

    it('asks for the details, drafts with them, and lands a draft with nothing to fill', async () => {
      const calls: SmsDraftRequest[] = []
      api.mock('POST /v1/outreach/sms/draft', ({ body }) => {
        calls.push(body)
        return {
          status: 200,
          data: {
            draft:
              'Join us for a neighborhood meet and greet.\n' +
              `📅 Saturday, September 12 | 🕐 6:30 PM | 📍 ${body.event?.location}\n` +
              'Reply here to RSVP.',
          },
        }
      })
      openFlow()

      await userEvent.click(screen.getByText('Invite voters to a local event'))

      expect(
        await screen.findByRole('heading', {
          level: 3,
          name: 'When and where is the event?',
        }),
      ).toBeInTheDocument()
      const continueButton = () =>
        screen.getByRole('button', { name: 'Continue' })
      expect(continueButton()).toBeDisabled()

      fillEventDetails('2026-08-20', '18:30', 'Georgetown Public Library')
      expect(screen.getByText(/That date has passed/)).toBeInTheDocument()
      expect(continueButton()).toBeDisabled()

      fillEventDetails('2026-09-12', '18:30', 'Georgetown Public Library')
      expect(continueButton()).toBeEnabled()
      await userEvent.click(continueButton())

      await userEvent.click(await screen.findByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
      )
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(continueButton())

      expect(
        await screen.findByText(/📍 Georgetown Public Library/),
      ).toBeInTheDocument()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        purpose: 'event_invite',
        event: {
          date: '2026-09-12',
          time: '18:30',
          location: 'Georgetown Public Library',
        },
      })
      expect(screen.queryByText(/Replace them with the real details/)).toBe(
        null,
      )
      await attachImage()
      await waitFor(() => expect(continueButton()).toBeEnabled())
    })

    it('opens the details on what an agent handed in', async () => {
      mockDraft()
      render(
        <SmsFlow
          source="outreach_page"
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
          tcrCompliance={TCR_FIXTURE}
          initialEvent={{
            date: '2026-09-15',
            time: '19:00',
            location: 'Main Street Park',
          }}
        />,
      )

      await userEvent.click(screen.getByText('Invite voters to a local event'))

      expect(await screen.findByLabelText('Date')).toHaveValue('2026-09-15')
      expect(screen.getByLabelText('Start time')).toHaveValue('19:00')
      expect(screen.getByLabelText('Location')).toHaveValue('Main Street Park')
      expect(screen.getByText(/We filled in what we know/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })

    it('skips the details step for every other purpose', async () => {
      mockDraft()
      openFlow()

      await userEvent.click(screen.getByText('Introduce myself to voters'))

      expect(
        (await screen.findAllByText('Who do you want to reach?')).length,
      ).toBeGreaterThan(0)
      expect(screen.queryByText('When and where is the event?')).toBe(null)
    })
  })

  // The greeting is part of the message, its first name a locked pill, so
  // a candidate writing their own body sees it already opens with "Hello" —
  // CAS saw "Hello {first_name}, Hello! My name is…" reach the P2P queue
  // while the greeting sat outside the box. The review bubble stays
  // verbatim: Win's greeting is Peerly's single-brace merge token.
  it('shows the greeting in the message, verbatim in the bubble', async () => {
    mockDraft()
    api.mock('GET /v1/outreach/:id/receipt', {
      status: 404,
      data: { message: 'No receipt' },
    })
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
    await userEvent.click(await screen.findByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
    )
    await userEvent.click(await screen.findByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/^Hello First name, this is Jane/),
    )
    expect(screen.queryByText(SMS_GREETING_PREVIEW.caption)).toBeNull()
    expect(screen.queryByText('Greeting First Name')).toBeNull()

    await attachImage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await userEvent.click(
      await screen.findByRole('button', { name: 'Preview message' }),
    )
    expect(
      await screen.findByText(SMS_GREETING, { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByText(SMS_GREETING_PREVIEW.caption)).toBeNull()
  })

  it('identifies the campaign owner, not the composer, in the intro', async () => {
    // A Campaign Manager (session user Jane) composing on Jared's campaign:
    // the identification intro and the standards check must use the OWNER's
    // name, or the client passes a script the server rejects at scheduling.
    campaignState.campaign = {
      ...campaignState.base(),
      ownerName: 'Jared Smith',
    }
    mockDraft()
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
    await userEvent.click(screen.getByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      screen.getByRole('button', { name: /Continue \(1,200\)/ }),
    )
    await screen.findByText('When do you want to send it?')
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/this is Jared, candidate for City Council\./),
    )
    expect(
      screen.getByRole('textbox', { name: 'Message body' }),
    ).not.toHaveTextContent(/this is Jane/)
  })

  it('resolves the intro office from positionName when normalizedOffice is empty', async () => {
    // normalizedOffice is empty for org-era onboardings; positionName (the
    // org's elections-DB position, on campaigns/mine) is the reliable source
    // — without it the intro reads "candidate for local office".
    campaignState.campaign = {
      ...campaignState.base(),
      positionName: 'Mayor',
      details: {},
    }
    mockDraft()
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
    await userEvent.click(screen.getByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      screen.getByRole('button', { name: /Continue \(1,200\)/ }),
    )
    await screen.findByText('When do you want to send it?')
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/this is Jane, candidate for Mayor\./),
    )
    expect(screen.queryByText(/local office/)).not.toBeInTheDocument()
  })

  describe('the message field', () => {
    // Improve gets the whole message back from gp-api, locked parts
    // restored there, so the mock answers with the message it was sent.
    const mockDraftAndImprove = () => {
      const calls: SmsDraftRequest[] = []
      api.mock('POST /v1/outreach/sms/draft', ({ body }) => {
        calls.push(body)
        return {
          status: 200,
          data: {
            draft: body.currentDraft
              ? body.currentDraft.replace('Vote soon.', 'Please vote soon!')
              : `AI body (${body.tone}) for ${body.purpose}`,
          },
        }
      })
      return calls
    }

    const reachCompose = async () => {
      openFlow()
      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(screen.getByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await userEvent.click(
        screen.getByRole('button', { name: /Continue \(1,200\)/ }),
      )
      await screen.findByText('When do you want to send it?')
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      const box = await screen.findByRole('textbox', { name: 'Message body' })
      await waitFor(() => expect(box).toHaveTextContent(/AI body \(warm\)/))
      const editor = (box as HTMLElement & { editor: Editor }).editor
      return { box, editor }
    }

    const endOf = (editor: Editor, needle: string): number => {
      let found = -1
      editor.state.doc.descendants((node, pos) => {
        if (found !== -1 || !node.isText) return
        const index = node.text?.indexOf(needle) ?? -1
        if (index !== -1) found = pos + index + needle.length
      })
      return found
    }

    const COMPOSED_DRAFT =
      'Hello {first_name}, this is Jane, candidate for City Council. ' +
      'AI body (warm) for introduce_myself\n\n' +
      'Paid for by Friends of Jane. Reply STOP to opt out.'

    it('holds the whole message, greeting to opt-out', async () => {
      mockDraftAndImprove()
      const { editor } = await reachCompose()
      await waitFor(() =>
        expect(editor.getText({ blockSeparator: '\n' })).toBe(COMPOSED_DRAFT),
      )
    })

    it('offers Regenerate on an untouched draft and Improve once edited', async () => {
      const calls = mockDraftAndImprove()
      const { box, editor } = await reachCompose()
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: 'Improve with AI' }),
      ).toBeNull()

      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })
      await userEvent.click(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      )

      await waitFor(() => expect(calls).toHaveLength(2))
      expect(calls[1]).toMatchObject({
        purpose: 'introduce_myself',
        tone: 'warm',
        currentDraft: COMPOSED_DRAFT.replace(
          'introduce_myself',
          'introduce_myself Vote soon.',
        ),
      })
      await waitFor(() => expect(box).toHaveTextContent(/Please vote soon!/))
      // A polish is still the candidate's words: the action stays Improve.
      expect(
        screen.getByRole('button', { name: 'Improve with AI' }),
      ).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(box).toHaveTextContent(/Vote soon\./))
    })

    // The polish endpoint takes a message within the 1000-character limit,
    // so over it neither the AI button nor a tone pill sends one; the note
    // says to shorten it instead.
    it('sends no polish for a message over the length limit', async () => {
      const calls = mockDraftAndImprove()
      const { editor } = await reachCompose()
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ` ${'Vote early. '.repeat(80)}`,
        )
      })

      expect(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      ).toBeDisabled()
      expect(
        screen.getByText(/Keep the whole message .* under 1000 characters/),
      ).toBeInTheDocument()

      await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))
      expect(screen.getByRole('radio', { name: /Direct/ })).toBeChecked()
      expect(calls).toHaveLength(1)
    })

    it('polishes edited words in a new tone rather than replacing them', async () => {
      const calls = mockDraftAndImprove()
      const { editor } = await reachCompose()
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })

      await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))

      await waitFor(() => expect(calls).toHaveLength(2))
      expect(calls[1]?.tone).toBe('direct')
      expect(calls[1]?.currentDraft).toContain('Vote soon.')
    })

    // A reply held until the candidate has acted, so the test can edit while
    // the call is still in flight.
    const mockHeldImprove = () => {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const answered = { done: false }
      api.mock('POST /v1/outreach/sms/draft', async ({ body }) => {
        if (!body.currentDraft) {
          return {
            status: 200,
            data: { draft: `AI body (${body.tone}) for ${body.purpose}` },
          }
        }
        await held
        answered.done = true
        return { status: 200, data: { draft: 'The AI rewrite.' } }
      })
      return { release, answered }
    }

    it('keeps what the candidate types while Improve is running', async () => {
      const { release, answered } = mockHeldImprove()
      const { box, editor } = await reachCompose()
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })
      await userEvent.click(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      )
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'Vote soon.'),
          ' Bring a friend.',
        )
      })
      release()
      await waitFor(() => expect(answered.done).toBe(true))
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

      expect(box).toHaveTextContent(/Vote soon\. Bring a friend\./)
      expect(box).not.toHaveTextContent(/The AI rewrite/)
    })

    // A call the candidate edited past can still fail. Its error must not
    // come back over words they already fixed.
    it("keeps the candidate's words when a superseded call fails late", async () => {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const answered = { done: false }
      api.mock('POST /v1/outreach/sms/draft', async ({ body }) => {
        if (!body.currentDraft) {
          return {
            status: 200,
            data: { draft: `AI body (${body.tone}) for ${body.purpose}` },
          }
        }
        await held
        answered.done = true
        return {
          status: 502,
          data: { message: 'SMS draft generation failed' },
        }
      })
      const { box, editor } = await reachCompose()
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })
      await userEvent.click(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      )
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'Vote soon.'),
          ' Bring a friend.',
        )
      })
      release()
      await waitFor(() => expect(answered.done).toBe(true))
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

      expect(
        screen.queryByText(/We couldn.t draft your message just now/),
      ).not.toBeInTheDocument()
      expect(box).toHaveTextContent(/Vote soon\. Bring a friend\./)
    })

    it('keeps an Undo made while Improve is running', async () => {
      const { release, answered } = mockHeldImprove()
      const { box, editor } = await reachCompose()
      // A first Improve that lands, so Undo has something to go back to.
      api.mockOrdered('POST /v1/outreach/sms/draft', [
        ({ body }) => ({
          status: 200,
          data: {
            draft: (body.currentDraft ?? '').replace('Vote soon.', 'Go vote!'),
          },
        }),
      ])
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })
      await userEvent.click(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      )
      await waitFor(() => expect(box).toHaveTextContent(/Go vote!/))

      await userEvent.click(
        screen.getByRole('button', { name: 'Improve with AI' }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      release()
      await waitFor(() => expect(answered.done).toBe(true))
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

      expect(box).toHaveTextContent(/Vote soon\./)
      expect(box).not.toHaveTextContent(/The AI rewrite/)
    })

    it('gives a failed first draft the locked parts to write between', async () => {
      api.mock('POST /v1/outreach/sms/draft', {
        status: 502,
        data: { message: 'SMS draft generation failed' },
      })
      openFlow()
      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(screen.getByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await userEvent.click(
        screen.getByRole('button', { name: /Continue \(1,200\)/ }),
      )
      await screen.findByText('When do you want to send it?')
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(
        await screen.findByText(/We couldn.t draft your message just now/),
      ).toBeInTheDocument()
      const box = await screen.findByRole('textbox', { name: 'Message body' })
      const editor = (box as HTMLElement & { editor: Editor }).editor
      await waitFor(() =>
        expect(editor.getText({ blockSeparator: '\n' })).toBe(
          'Hello {first_name},\n\nPaid for by Friends of Jane. ' +
            'Reply STOP to opt out.',
        ),
      )
    })

    // Typing is the candidate taking over from the failed draft, so the
    // card goes and Try again cannot improve their words.
    it('clears the draft error once the candidate types', async () => {
      api.mock('POST /v1/outreach/sms/draft', {
        status: 502,
        data: { message: 'SMS draft generation failed' },
      })
      openFlow()
      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(screen.getByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await userEvent.click(
        screen.getByRole('button', { name: /Continue \(1,200\)/ }),
      )
      await screen.findByText('When do you want to send it?')
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(
        await screen.findByText(/We couldn.t draft your message just now/),
      ).toBeInTheDocument()
      const box = await screen.findByRole('textbox', { name: 'Message body' })
      const editor = (box as HTMLElement & { editor: Editor }).editor
      await waitFor(() => expect(endOf(editor, 'Hello ')).toBeGreaterThan(0))
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, ','),
          ' this is Sarah Chen.',
        )
      })

      await waitFor(() =>
        expect(
          screen.queryByText(/We couldn.t draft your message just now/),
        ).not.toBeInTheDocument(),
      )
    })

    // A gp-api from before masking answers Improve with a body alone. The
    // flow composes the greeting and footer back around it, so a polish
    // never sends without the disclaimer or opt-out.
    it('composes the greeting and footer back around a body-only Improve reply', async () => {
      api.mock('POST /v1/outreach/sms/draft', ({ body }) => ({
        status: 200,
        data: {
          draft: body.currentDraft
            ? 'this is Jane, candidate for City Council. Please vote soon!'
            : `AI body (${body.tone}) for ${body.purpose}`,
        },
      }))
      const { editor } = await reachCompose()
      act(() => {
        editor.commands.insertContentAt(
          endOf(editor, 'introduce_myself'),
          ' Vote soon.',
        )
      })
      await userEvent.click(
        await screen.findByRole('button', { name: 'Improve with AI' }),
      )

      await waitFor(() =>
        expect(editor.getText({ blockSeparator: '\n' })).toBe(
          'Hello {first_name}, this is Jane, candidate for City Council. ' +
            'Please vote soon!\n\n' +
            'Paid for by Friends of Jane. Reply STOP to opt out.',
        ),
      )
    })

    it('refuses an edit inside a locked part and says why', async () => {
      mockDraftAndImprove()
      const { editor } = await reachCompose()
      const at = endOf(editor, 'Reply ST')
      act(() => {
        editor.view.dispatch(editor.state.tr.delete(at - 1, at))
      })

      expect(await screen.findByRole('status')).toHaveTextContent(
        'The opt-out line has to stay in the message.',
      )
      expect(editor.getText()).toContain('Reply STOP to opt out.')
    })
  })

  it('falls back to normalizedOffice when positionName is empty', async () => {
    // resolvePositionContext passes customPositionName through `??`, so an
    // empty-string positionName can reach the client and must not mask a
    // populated normalizedOffice.
    campaignState.campaign = {
      ...campaignState.base(),
      positionName: '',
    }
    mockDraft()
    openFlow()

    await userEvent.click(screen.getByText('Introduce myself to voters'))
    await userEvent.click(screen.getByText('Choose a voter list'))
    await userEvent.click(await screen.findByText('Likely voters'))
    await userEvent.click(
      screen.getByRole('button', { name: /Continue \(1,200\)/ }),
    )
    await screen.findByText('When do you want to send it?')
    await userEvent.click(screen.getByText('Pick a date'))
    await userEvent.click(
      await screen.findByRole('button', { name: dayName(4) }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/this is Jane, candidate for City Council\./),
    )
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
          source="outreach_page"
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

    // Words the product carried in or wrote are checked for the sender's
    // name before the compose step shows them; words the candidate typed
    // never are.
    describe('identification', () => {
      const INTRO = 'this is Jane, candidate for City Council.'

      // The field holds the whole message; these cases are about the body
      // between its greeting and its footer, which is what the repair edits.
      const editorOf = (box: HTMLElement) =>
        (box as HTMLElement & { editor: Editor }).editor
      const bodyOf = (box: HTMLElement) =>
        editorOf(box)
          .getText({ blockSeparator: '\n' })
          .replace(/^Hello \{first_name\}, ?/, '')
          .replace(
            /\n\n(?:Paid for by [^\n]*?\.[ \n])?Reply STOP to opt out\.$/,
            '',
          )
      const endOf = (box: HTMLElement, needle: string): number => {
        let found = -1
        editorOf(box).state.doc.descendants((node, pos) => {
          if (found !== -1 || !node.isText) return
          const index = node.text?.indexOf(needle) ?? -1
          if (index !== -1) found = pos + index + needle.length
        })
        return found
      }

      const reachCompose = async (initialScript: string) => {
        openSeeded({ initialScript, preselectedListId: 41 })
        await userEvent.click(
          await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
        )
        await userEvent.click(await screen.findByText('Pick a date'))
        await userEvent.click(
          await screen.findByRole('button', { name: dayName(4) }),
        )
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        return screen.findByRole('textbox', { name: 'Message body' })
      }

      it('opens a seed with no name on the intro', async () => {
        const box = await reachCompose('Hello {first_name}, vote Tuesday.')

        await waitFor(() => expect(bodyOf(box)).toBe(`${INTRO} Vote Tuesday.`))
        expect(
          screen.queryByText(/messages must include your name/),
        ).not.toBeInTheDocument()
      })

      it('replaces a placeholder opener and fills the real name', async () => {
        const box = await reachCompose(
          'Hi, this is [Your Name] from the City of Austin. Vote Tuesday. Questions? Ask for [your name].',
        )

        await waitFor(() =>
          expect(bodyOf(box)).toBe(
            `${INTRO} Vote Tuesday. Questions? Ask for Jane.`,
          ),
        )
      })

      it('leaves a seed that already names the candidate alone', async () => {
        const box = await reachCompose(`${INTRO} Vote Tuesday.`)

        await waitFor(() => expect(bodyOf(box)).toBe(`${INTRO} Vote Tuesday.`))
      })

      it('never rewrites what the candidate typed', async () => {
        const box = await reachCompose('Vote Tuesday.')
        await waitFor(() => expect(bodyOf(box)).toBe(`${INTRO} Vote Tuesday.`))
        act(() => {
          editorOf(box).commands.insertContentAt(
            endOf(box, 'Vote Tuesday.'),
            ' Vote early, friends.',
          )
        })

        await waitFor(() =>
          expect(bodyOf(box)).toBe(
            `${INTRO} Vote Tuesday. Vote early, friends.`,
          ),
        )
      })

      it('keeps one intro per tone across fresh drafts and tone switches', async () => {
        api.mock('POST /v1/outreach/sms/draft', ({ body }) => ({
          status: 200,
          data: {
            draft:
              body.tone === 'direct'
                ? 'Hi, this is Jane, running for City Council. Vote early.'
                : 'Vote Tuesday.',
          },
        }))
        openFlow()
        await userEvent.click(screen.getByText('Introduce myself to voters'))
        await userEvent.click(await screen.findByText('Choose a voter list'))
        await userEvent.click(await screen.findByText('Likely voters'))
        await userEvent.click(
          await screen.findByRole('button', { name: /Continue \(1,200\)/ }),
        )
        await userEvent.click(await screen.findByText('Pick a date'))
        await userEvent.click(
          await screen.findByRole('button', { name: dayName(4) }),
        )
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
        const box = await screen.findByRole('textbox', {
          name: 'Message body',
        })
        const direct = 'Jane here, candidate for City Council. Vote early.'

        await waitFor(() => expect(bodyOf(box)).toBe(`${INTRO} Vote Tuesday.`))
        await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))
        await waitFor(() => expect(bodyOf(box)).toBe(direct))
        await userEvent.click(screen.getByRole('radio', { name: /Warm/ }))
        await waitFor(() => expect(bodyOf(box)).toBe(`${INTRO} Vote Tuesday.`))
        await userEvent.click(screen.getByRole('radio', { name: /Direct/ }))
        await waitFor(() => expect(bodyOf(box)).toBe(direct))
      })

      it('flags brackets left to fill and holds Continue', async () => {
        await reachCompose('Rally at [Location] on [Date].')
        await attachImage()

        expect(
          screen.getByText(
            'Your message still has [Location], [Date]. Replace them with the real details before you send.',
          ),
        ).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      })
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
    // Matched on a prefix, because the exact accessible name here is a race
    // the assertion does not care about: the CTA reads "Continue" only while
    // the unfiltered count is in flight and "Continue (875)" once it lands.
    // Pinning the bare name waited out the full async timeout on any run where
    // the mocked count resolved first, which is what made this test flaky.
    // What is actually under test is that it stays disabled with no selection,
    // and that holds in either label state.
    expect(
      await screen.findByRole('button', { name: /^Continue/ }),
    ).toBeDisabled()
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

    // The count reads are open to a free campaign now, so the picker prices
    // a saved list the same way it does for Pro.
    const mockFreeAudience = () => {
      let listDetailCalls = 0
      api.mock('GET /v1/contacts/list-detail', () => {
        listDetailCalls += 1
        return {
          status: 200,
          data: {
            demographics: { people: 1500, avgAge: null, avgIncome: null },
            reachability: {
              sms: 900,
              robocall: null,
              phoneBanking: null,
              doorKnocking: null,
              polls: null,
            },
            outreachHistory: [],
          },
        }
      })
      api.mock('GET /v1/campaigns/mine/recommended-lists', {
        status: 200,
        data: [RECOMMENDATION],
      })
      return () => listDetailCalls
    }

    const FREE_GATE: OutreachGateState = {
      enabled: true,
      resolved: true,
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
      resolved: true,
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
      'Paid for by Friends of Jane. Reply STOP to opt out.'

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
    it('reaches the name step with the audience priced', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      openFlow()

      await buildToName()

      expect(screen.getByLabelText('Campaign name')).toHaveValue(
        'Likely voters — SMS',
      )
      expect(screen.queryByText('Send date')).not.toBeInTheDocument()
      expect(screen.queryByText('Review and verify')).not.toBeInTheDocument()
    })

    // The FIRST time a recommendation is taken there is no saved list yet, so
    // it goes through createRecommendedList rather than the reuse branch,
    // and the build has to land on the name step off that list.
    it('saves a recommendation taken for the first time and reaches the name step', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
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
      const { rerender } = render(
        <SmsFlow source="outreach_page" open {...props} />,
      )
      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()

      rerender(<SmsFlow source="outreach_page" open={false} {...props} />)
      rerender(<SmsFlow source="outreach_page" open {...props} />)

      expect(await screen.findByTestId('pro-upgrade-flow')).toBeInTheDocument()
      expect(
        screen.queryByText('When do you want to send it?'),
      ).not.toBeInTheDocument()
    })

    it('opens a cleared draft at the schedule step and converts it', async () => {
      gateRef.set(CLEARED_GATE)
      render(
        <SmsFlow
          source="outreach_page"
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

    // QA 2026-09-30: an unverified campaign has no committee yet. The line
    // still shows, naming a provisional committee, and the rule the server
    // would apply to it must not block the build.
    it('shows a provisional paid-for-by line and does not block build mode', async () => {
      gateRef.set(FREE_GATE)
      mockDraft()
      mockFreeAudience()
      render(
        <SmsFlow
          source="outreach_page"
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
        />,
      )

      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Persuadable independents'))
      await userEvent.click(
        await screen.findByRole('button', { name: /Continue \(900\)/ }),
      )
      expect(
        await screen.findByText(/AI body \(warm\) for introduce_myself/),
      ).toBeInTheDocument()
      await attachImage()

      expect(
        screen.getByRole('textbox', { name: 'Message body' }),
      ).toHaveTextContent(/Paid for by Jane Doe\. Reply STOP/)
      expect(
        screen.queryByText(/keep the "Paid for by" line/),
      ).not.toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
      )
    })

    // A draft saved before verification carries no paid-for-by line, and
    // the resume schedules the saved script verbatim -- without the footer
    // upgrade the server-side compliance gate 400s the conversion.
    it('upgrades a pre-verification draft footer at resume', async () => {
      gateRef.set(CLEARED_GATE)
      const preVerificationScript =
        'Hello {first_name}, this is Jane, candidate for City Council. ' +
        'Vote Tuesday.\n\nReply STOP to opt out.'
      render(
        <SmsFlow
          source="outreach_page"
          open
          onClose={vi.fn()}
          onScheduled={vi.fn().mockResolvedValue(undefined)}
          tcrCompliance={TCR_FIXTURE}
          resumeDraft={draftDetail({ script: preVerificationScript })}
        />,
      )

      expect(
        await screen.findByText('When do you want to send it?'),
      ).toBeInTheDocument()
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() =>
        expect(vi.mocked(createOutreach)).toHaveBeenCalledWith(
          expect.objectContaining({
            draftOutreachId: 88,
            script:
              'Hello {first_name}, this is Jane, candidate for City Council. ' +
              'Vote Tuesday.\n\nPaid for by Friends of Jane. ' +
              'Reply STOP to opt out.',
          }),
          null,
        ),
      )
    })

    it('blocks the resume when the draft list is gone', async () => {
      gateRef.set(CLEARED_GATE)
      api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
      render(
        <SmsFlow
          source="outreach_page"
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

    it('keeps the builder for an ungated elected official', async () => {
      gateRef.set({
        enabled: true,
        resolved: true,
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

  describe('phone list build status', () => {
    // Restores the module mock's original (ready) behavior so later tests in
    // this file are never affected by an override left behind here.
    afterEach(() => {
      vi.mocked(createP2pPhoneList).mockReset()
      vi.mocked(createP2pPhoneList).mockImplementation(async () => ({
        ok: true,
        token: 'tok-1',
        buildId: 'build-1',
      }))
      vi.mocked(getP2pPhoneListBuildStatus).mockReset()
      vi.mocked(getP2pPhoneListBuildStatus).mockImplementation(async () => ({
        buildStatus: 'ready',
        phoneListId: 77,
        leadsLoaded: 1200,
        excludedOptedOutCount: 3,
        excludedDuplicatePhoneCount: 1,
      }))
    })

    const runToReview = async () => {
      mockDraft()
      await userEvent.click(screen.getByText('Introduce myself to voters'))
      await userEvent.click(await screen.findByText('Choose a voter list'))
      await userEvent.click(await screen.findByText('Likely voters'))
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Continue \(1,200\)/ }),
        ).toBeEnabled(),
      )
      await userEvent.click(
        screen.getByRole('button', { name: /Continue \(1,200\)/ }),
      )
      await screen.findByText('When do you want to send it?')
      await userEvent.click(screen.getByText('Pick a date'))
      await userEvent.click(
        await screen.findByRole('button', { name: dayName(4) }),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByRole('textbox', { name: 'Message body' })
      await attachImage()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    }

    it('shows a preparing state while the build is still in progress and never flashes the failed card', async () => {
      vi.mocked(getP2pPhoneListBuildStatus).mockResolvedValue({
        buildStatus: 'building',
      })
      openFlow()
      await runToReview()

      expect(
        await screen.findByRole('status', { name: 'Loading' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText("We couldn't prepare this audience. Try again."),
      ).not.toBeInTheDocument()
    })

    it('shows the build-failed state with a retry that requests a fresh build', async () => {
      vi.mocked(createP2pPhoneList)
        .mockReset()
        .mockResolvedValueOnce({ ok: true, token: 'tok-1', buildId: 'build-1' })
        .mockResolvedValueOnce({ ok: true, token: 'tok-2', buildId: 'build-2' })
      vi.mocked(getP2pPhoneListBuildStatus).mockImplementation(
        async (buildId) =>
          buildId === 'build-1'
            ? {
                buildStatus: 'failed',
                buildError: 'No contacts matched the filter.',
              }
            : {
                buildStatus: 'ready',
                phoneListId: 77,
                leadsLoaded: 1200,
                excludedOptedOutCount: 3,
                excludedDuplicatePhoneCount: 1,
              },
      )
      openFlow()
      await runToReview()

      expect(
        await screen.findByText(
          "We couldn't prepare this audience. Try again.",
        ),
      ).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      await waitFor(() =>
        expect(
          screen.queryByText("We couldn't prepare this audience. Try again."),
        ).not.toBeInTheDocument(),
      )
      expect(await screen.findByText('1,200')).toBeInTheDocument()
      expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(2)
    })

    it('rebuilds automatically on Back from a failed build, so re-entering review is not stuck on the stale failure', async () => {
      vi.mocked(createP2pPhoneList)
        .mockReset()
        .mockResolvedValueOnce({ ok: true, token: 'tok-1', buildId: 'build-1' })
        .mockResolvedValueOnce({ ok: true, token: 'tok-2', buildId: 'build-2' })
      vi.mocked(getP2pPhoneListBuildStatus).mockImplementation(
        async (buildId) =>
          buildId === 'build-1'
            ? {
                buildStatus: 'failed',
                buildError: 'No contacts matched the filter.',
              }
            : {
                buildStatus: 'ready',
                phoneListId: 77,
                leadsLoaded: 1200,
                excludedOptedOutCount: 3,
                excludedDuplicatePhoneCount: 1,
              },
      )
      openFlow()
      await runToReview()

      expect(
        await screen.findByText(
          "We couldn't prepare this audience. Try again.",
        ),
      ).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await screen.findByRole('textbox', { name: 'Message body' })

      // Back already re-requested a fresh build in the background -- the
      // candidate doesn't have to notice the stale failure and press retry
      // themselves before continuing.
      await waitFor(() =>
        expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(2),
      )

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(
        screen.queryByText("We couldn't prepare this audience. Try again."),
      ).not.toBeInTheDocument()
      expect(await screen.findByText('1,200')).toBeInTheDocument()
    })

    it('keeps a successful build across Back/forward without rebuilding it', async () => {
      openFlow()
      await runToReview()

      expect(await screen.findByText('1,200')).toBeInTheDocument()
      expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(1)

      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      await screen.findByRole('textbox', { name: 'Message body' })
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('1,200')).toBeInTheDocument()
      expect(vi.mocked(createP2pPhoneList)).toHaveBeenCalledTimes(1)
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
