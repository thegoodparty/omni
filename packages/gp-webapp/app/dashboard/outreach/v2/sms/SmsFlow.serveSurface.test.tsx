import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { ServeSmsDraftRequest } from '@goodparty_org/contracts'
import { checkSmsStandards } from '@goodparty_org/contracts'
import { SERVE_SMS_SURFACE, SmsFlow } from './SmsFlow'
import {
  OPT_OUT_FOOTER,
  SERVE_SMS_GREETING,
  SERVE_SMS_GREETING_PREVIEW,
  SERVE_SMS_SAMPLE_FIRST_NAME,
  SMS_GREETING,
  withSampleFirstName,
} from './smsCompose.util'

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

// Untyped clientFetch path, so module-mocked rather than MSW-mocked. Serve
// has no Peerly phone list of its own yet — replacing this derivation with
// the org-scoped create is the hub-wiring ticket's job, not the surface's.
vi.mock('helpers/createP2pPhoneList', () => ({
  createP2pPhoneList: vi.fn(async () => ({ ok: true, token: 'tok-1' })),
  getP2pPhoneListStatus: vi.fn(async () => ({
    phoneListId: 77,
    leadsLoaded: 1200,
    excludedOptedOutCount: 0,
    excludedDuplicatePhoneCount: 0,
  })),
}))

// An elected official has no campaign row at all — that is the whole reason
// the Serve surface exists.
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [null, vi.fn()],
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-jane-doe', district: {} }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [
    { id: 1, firstName: 'Jane', lastName: 'Doe' },
    vi.fn(),
    false,
  ],
}))

// Tuesday, so the first bookable day (+3 => Friday the 4th) stays inside the
// month and its day number addresses exactly one calendar cell.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

let recommendedListsRequested = false

const openServeFlow = () => {
  const onClose = vi.fn()
  const onScheduled = vi.fn().mockResolvedValue(undefined)
  render(
    <SmsFlow
      open
      onClose={onClose}
      onScheduled={onScheduled}
      surface={SERVE_SMS_SURFACE}
    />,
  )
  return { onClose, onScheduled }
}

describe('SmsFlow (Serve surface)', () => {
  beforeEach(() => {
    recommendedListsRequested = false
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
    api.mock('GET /v1/elected-office/current', {
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
    })
    api.mock('GET /v1/contacts/precincts', {
      status: 200,
      data: { options: [], truncated: false },
    })
    api.mock('GET /v1/outreach', { status: 200, data: [] })
    // Answered so an accidental request is visible as a flipped flag rather
    // than an MSW unhandled-request warning.
    api.mock('GET /v1/campaigns/mine/recommended-lists', () => {
      recommendedListsRequested = true
      return { status: 200, data: [] }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers the serve purpose cards, not the win ones', async () => {
    openServeFlow()

    expect(
      await screen.findByText('Explain a recent decision'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ask for community input')).toBeInTheDocument()
    expect(screen.getByText('Share a resource or service')).toBeInTheDocument()
    // Win's electoral slugs have no serve counterpart.
    expect(screen.queryByText(/Get out the vote|Early voting/i)).toBeNull()
    expect(
      screen.getByText(
        'This helps us draft the right message for your constituents.',
      ),
    ).toBeInTheDocument()
  })

  it('never asks for recommended lists, even on a slug Win also uses', async () => {
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
    openServeFlow()

    // introduce_myself is one of the three slugs shared with Win, so a
    // purpose-string check would have mapped it to a Win intent and fired
    // the campaign-scoped endpoint against an eo- org.
    await userEvent.click(
      await screen.findByText('Introduce myself to constituents'),
    )
    await screen.findByText(
      'Select a list or create a new one. Lists include all constituents with a mobile number.',
    )

    expect(recommendedListsRequested).toBe(false)
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('frames the audience step for constituents', async () => {
    openServeFlow()
    await userEvent.click(
      await screen.findByText('Introduce myself to constituents'),
    )

    expect(
      await screen.findByText(
        'Select a list or create a new one. Lists include all constituents with a mobile number.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/all voters with a mobile number/)).toBeNull()
  })

  it('schedules by date only, at a fixed 11am, and drafts against the serve endpoint', async () => {
    const draftCalls: ServeSmsDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/sms/draft', ({ body }) => {
      draftCalls.push(body)
      return { status: 200, data: { draft: 'drafted body' } }
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )

    // The serve step: the promise is stated, never picked.
    expect(
      await screen.findByText(/All messages are sent at 11am local time\./),
    ).toBeInTheDocument()
    expect(screen.queryByText('Send time')).toBeNull()
    expect(screen.queryByText(/48 hours/)).toBeNull()

    // Friday the 4th — the first day the borrowed polls predicate leaves open.
    await userEvent.click(
      screen.getByRole('button', { name: /^Friday, September 4(?!\d)/ }),
    )
    expect(
      await screen.findByText(/Estimated completion: Wed, Sep 9, 2026\./),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(draftCalls).toHaveLength(1))
    expect(draftCalls[0]).toMatchObject({
      purpose: 'explain_decision',
      tone: 'warm',
    })
  })

  it('keeps the opt-out footer and appends no paid-for-by line', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(OPT_OUT_FOOTER)).toBeInTheDocument()
    expect(screen.queryByText(/Paid for by/)).toBeNull()
  })

  // "Campaign" is Win vocabulary: an elected official has an office and a
  // term. This string lives on the shared compose step, which the
  // per-surface records cannot reach, so it keys on the surface's own
  // isServe flag rather than being renamed for everyone.
  it('asks for a header image, not a campaign headshot', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('Add a header image (optional)'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/campaign headshot/i)).not.toBeInTheDocument()
  })

  // The chip used to read "Greeting First Name", which names a variable
  // rather than showing the words a constituent reads. It now shows the
  // greeting with a stand-in name, and the caption says the name changes.
  it('shows the greeting as it will read, with a stand-in first name', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(`Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`),
    ).toBeInTheDocument()
    expect(
      screen.getByText(SERVE_SMS_GREETING_PREVIEW.caption),
    ).toBeInTheDocument()
    expect(screen.queryByText('Greeting First Name')).toBeNull()
    expect(screen.queryByText(/\{\{first_name\}\}/)).toBeNull()
  })

  // Win's image gate is Peerly's: it rejects an imageless text/p2p send.
  // Serve's fulfilment takes imageUrl as optional all the way down, so the
  // gate would be asking for a file nothing needs.
  it('lets a message with no image continue to review', async () => {
    api.mock('POST /v1/outreach/serve/sms/draft', {
      status: 200,
      data: { draft: 'drafted body' },
    })
    openServeFlow()

    await userEvent.click(await screen.findByText('Explain a recent decision'))
    await userEvent.click(await screen.findByText('Choose a constituent list'))
    await userEvent.click(await screen.findByText('Northside residents'))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Continue \(1,200\)$/ }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: /^Friday, September 4(?!\d)/,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The compose card renders as soon as the draft fills the body, which
    // can be a tick before draftMutation.isPending clears — and Continue is
    // disabled for that tick.
    await waitFor(() => {
      screen.getByText('Add a header image (optional)')
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })
  })
})

// Unit-level guards on the surface itself, so the seam is pinned even where
// driving the whole flow would not reach it.
describe('SERVE_SMS_SURFACE', () => {
  it('composes the opt-out footer alone, whatever committee it is handed', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Council voted to repave Oak St.',
      'Friends of Jane',
    )
    expect(composed).toContain(OPT_OUT_FOOTER)
    expect(composed).not.toContain('Paid for by')
  })

  // Peerly merges the single-brace token; the Slack fulfilment path Serve
  // rides merges the double-brace one, the same form polls converts its
  // authored [Name] into. Emitting Win's token here would text a constituent
  // the literal characters.
  it('greets with the double-brace merge token, not Peerly’s', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Oak St is repaved.',
      null,
    )
    expect(composed).toContain(SERVE_SMS_GREETING)
    expect(composed).toContain('{{first_name}}')
    // Win's greeting is untouched and keeps the single-brace form.
    expect(SMS_GREETING).toBe('Hello {first_name},')
  })

  // Why the double brace needs no second ignoredStandardsRules entry: the
  // rule is a substring test, and the inner twelve characters of
  // "{{first_name}}" are exactly "{first_name}". Asserted rather than
  // reasoned about, because the whole Serve compose CTA hangs off it.
  it('still satisfies the first_name_token standards rule', () => {
    expect('{{first_name}}'.includes('{first_name}')).toBe(true)
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'this is Jane, your council member. Oak St is repaved.',
      null,
    )
    const verdict = checkSmsStandards(composed, { candidateNames: ['Jane'] })
    expect(verdict.failures).not.toContain('first_name_token')
    // paid_for_by stays the one and only override.
    expect(verdict.failures).toEqual(['paid_for_by'])
    expect(SERVE_SMS_SURFACE.ignoredStandardsRules).toEqual(['paid_for_by'])
  })

  // The preview substitution is display-only. Asserted on the helper as
  // well as in the flow, because the whole safety of showing a name instead
  // of the token rests on composeMessage staying untouched.
  it('substitutes the sample name for display without changing the script', () => {
    const composed = SERVE_SMS_SURFACE.composeMessage(
      'Oak St is repaved.',
      null,
    )
    expect(composed).toContain('{{first_name}}')
    const shown = withSampleFirstName(composed)
    expect(shown).toContain(`Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`)
    expect(shown).not.toContain('{{first_name}}')
    expect(shown).not.toContain('{first_name}')
    expect(SERVE_SMS_GREETING_PREVIEW.greeting).toBe(
      `Hello ${SERVE_SMS_SAMPLE_FIRST_NAME},`,
    )
  })

  it('suggests an outreach campaign name per purpose', () => {
    expect(SERVE_SMS_SURFACE.nameSuggestion('explain_decision')).toBe(
      'Decision update texts',
    )
    expect(SERVE_SMS_SURFACE.nameSuggestion('')).toBe('Text campaign')
  })

  it('sends at a fixed morning hour rather than an hourly slot', () => {
    expect(SERVE_SMS_SURFACE.scheduleMode).toBe('serveFixedMorning')
    expect(SERVE_SMS_SURFACE.isServe).toBe(true)
  })
})
