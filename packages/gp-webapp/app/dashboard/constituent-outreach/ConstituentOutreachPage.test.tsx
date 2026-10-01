import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSearchParams } from 'next/navigation'
import type {
  ServePhoneBankingCreate,
  ServePhoneBankingScriptDraftRequest,
  ServeSocialDraftRequest,
  ServeSocialGenerateRequest,
  SocialAsset,
  SocialAssetPlatform,
} from '@goodparty_org/contracts'
import ConstituentOutreachPage from './ConstituentOutreachPage'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

// Desktop history table, scoped so its content isn't confused with the
// mobile card list (also in the DOM, hidden via CSS).
const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

// The real layout is a sidebar shell that needs an OrganizationProvider this
// suite has no use for — a stub keeps the focus on the content it wraps.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// The compose step mounts dictation unconditionally — same precedent as
// SocialFlow.test.tsx / PhoneBankingFlow.test.tsx.
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

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

// The phone banking flow's audience builder (useListWizardCount) reads the
// active org slug — same precedent as PhoneBankingFlow.test.tsx.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))

// `serve-sms-outreach`. Mutable so one file can drive all three states the
// page has to handle — resolved on, resolved off, and still resolving —
// because the difference between the last two is the flash the feature-flags
// doc calls the top anti-pattern. Defaults to OFF so every pre-SMS
// expectation in this file keeps asserting the pre-SMS page.
const serveSmsFlag = vi.hoisted(() => ({ ready: true, enabled: false }))
vi.mock('@shared/experiments/serveSmsFlag', () => ({
  SERVE_SMS_FLAG_KEY: 'serve-sms-outreach',
  useServeSmsFlag: () => serveSmsFlag,
}))

// The phone banking flow's audience step calls these on mount/interaction
// regardless of which test exercises it — mocked at module scope, same as
// PhoneBankingFlow.test.tsx's beforeEach, so every test in this file that
// opens the phone banking flow gets a working audience step for free.
const mockPhoneBankingAudience = () => {
  api.mock('GET /v1/elected-office/current', {
    status: 404,
    data: { message: 'No elected office' },
  })
  api.mock('GET /v1/voters/voter-file/filters', {
    status: 200,
    data: [{ id: 3, name: 'Downtown constituents' }],
  })
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 42 } })
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: {
      demographics: { people: 20, avgAge: null, avgIncome: null },
      reachability: {
        sms: null,
        robocall: null,
        phoneBanking: 10,
        doorKnocking: null,
        polls: null,
      },
      outreachHistory: [],
    },
  })
}

const assetFor = (platform: SocialAssetPlatform): SocialAsset => ({
  platform,
  kind:
    platform === 'tiktok' || platform === 'youtube_shorts'
      ? 'video_script'
      : 'post_copy',
  text: `Adapted for ${platform}`,
  caption:
    platform === 'tiktok' || platform === 'youtube_shorts'
      ? `Caption for ${platform}`
      : null,
})

const draftFor = ({ purpose, tone }: ServeSocialDraftRequest) =>
  `AI draft (${tone}) for ${purpose}`

const mockServeDraft = () => {
  const calls: ServeSocialDraftRequest[] = []
  api.mock('POST /v1/outreach/serve/social/draft', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { draft: draftFor(body) } }
  })
  return calls
}

const mockServeGenerate = () => {
  const calls: ServeSocialGenerateRequest[] = []
  api.mock('POST /v1/outreach/serve/social/generate', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { assets: body.platforms.map(assetFor) } }
  })
  return calls
}

const savedDetail = {
  id: 77,
  createdAt: new Date('2026-08-30T00:00:00Z'),
  updatedAt: new Date('2026-08-30T00:00:00Z'),
  campaignId: null,
  outreachType: 'socialMedia' as const,
  projectId: null,
  name: 'Introduction posts',
  status: 'completed' as const,
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: 'eo-test-org',
  archivedAt: null,
  social: {
    purpose: 'introduce_myself',
    draftMessage: 'draft',
    assets: [assetFor('facebook')],
  },
}

const user = userEvent.setup()

describe('ConstituentOutreachPage — Serve outreach history', () => {
  it('renders seeded outreach rows (channel, name, status, date)', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar walk',
        status: 'in_progress',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    expect(table.getByText('Elm & Cedar walk')).toBeInTheDocument()
    expect(table.getByText('Door knocking')).toBeInTheDocument()
    expect(table.getByText('In progress')).toBeInTheDocument()
  })

  // A walk opens the same drawer its Win counterpart does, because 3.0 gives
  // every turf an `Outreach` envelope — including a Serve org's, which the old
  // `if (campaign)` skipped — so a Serve row finally has a detail to show.
  it('opens a door-knocking row like every other wired channel', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar walk',
        status: 'in_progress',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const row = within(desktopTable())
      .getByText('Elm & Cedar walk')
      .closest('tr')
    expect(row).toHaveAttribute('role', 'button')
  })

  // Robocall is the channel that stays out for good — no compliance or
  // payment machinery on Serve — and a row for it is still a dead end rather
  // than a dead clickable element.
  it('renders an unwired row as plain, non-interactive content', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'robocall',
        name: 'Budget update call',
        status: 'completed',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const row = within(desktopTable())
      .getByText('Budget update call')
      .closest('tr')
    expect(row).not.toHaveAttribute('role', 'button')
    expect(row).not.toHaveAttribute('tabindex')
  })

  // A Serve SMS send is a `text` row on the spine, and it opens like every
  // other wired channel. Asserted with the flag OFF on purpose: the flag
  // gates the way in, not the record of a send already paid for, so an org
  // that loses the flag must not lose its own results.
  it('opens an SMS row even when the flag is off, and badges it SMS', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'text',
        name: 'Budget update texts',
        status: 'completed',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    const row = table.getByText('Budget update texts').closest('tr')
    expect(row).toHaveAttribute('role', 'button')
    // CHANNEL_META.text, not the raw-type fallback ("Text" in a grey badge).
    expect(table.getByText('SMS')).toBeInTheDocument()
  })

  it('renders a clean empty state with no rows', () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    // The history table renders both a desktop table and a mobile card list
    // (one hidden via CSS, not removed from the DOM), so the empty message
    // appears twice.
    expect(
      screen.getAllByText(
        'No campaigns yet. Pick a channel above to create your first.',
      ),
    ).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the social flow (serve surface) when the Social media card is clicked', async () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(screen.getByRole('button', { name: /Phone banking/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Door knocking/ })).toBeEnabled()

    await user.click(screen.getByText('Social media'))

    // A serve-only purpose card proves SERVE_SOCIAL_SURFACE (not Win's) is
    // wired in — Win's PurposeStep has no "Explain a recent decision" card.
    expect(
      await screen.findByText('Explain a recent decision'),
    ).toBeInTheDocument()
  })

  // Door knocking is the one Serve channel that leaves this page rather than
  // opening a flow on it: its surface is the map, which decides Win-or-Serve
  // for itself from the same predicate its page gate uses to grant access.
  it('navigates to the map when the Door knocking card is clicked', async () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    await user.click(screen.getByText('Door knocking'))

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page',
    )
    expect(
      screen.queryByText('Explain a recent decision'),
    ).not.toBeInTheDocument()
  })

  it('opens the phone banking flow (serve surface) when the Phone banking card is clicked', async () => {
    mockPhoneBankingAudience()
    render(<ConstituentOutreachPage outreaches={[]} />)

    await user.click(screen.getByText('Phone banking'))

    // "Write my own script" is phone banking's custom-purpose card copy;
    // social's is "Write my own message" — proves the phone banking flow
    // (not the social flow) mounted, on the serve surface (SERVE_PHONE_
    // BANKING_SURFACE's Win-side equivalent has no "constituents" framing).
    expect(
      await screen.findByText('Introduce myself to constituents'),
    ).toBeInTheDocument()
    expect(screen.getByText('Write my own script')).toBeInTheDocument()
  })

  it('onSaved seeds the new row into history without a page reload', async () => {
    mockServeDraft()
    mockServeGenerate()
    api.mock('POST /v1/outreach/serve/social', {
      status: 200,
      data: savedDetail,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    await user.click(screen.getByText('Social media'))
    await user.click(await screen.findByText('Introduce myself'))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      (await screen.findAllByText('Where do you want to share it?')).length,
    ).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Your posts are ready!')).toBeInTheDocument()

    // The row is already in history the moment save succeeds — a plain text
    // query (not role-scoped) finds it even while the flow sheet still
    // occupies the accessibility tree, since the row was seeded via state,
    // not a refetch of the list route. Both the desktop table and the mobile
    // card list render it (one hidden via CSS, not removed from the DOM).
    expect(await screen.findAllByText('Introduction posts')).toHaveLength(2)
  })

  it('clicking a saved social row opens the drawer against the serve detail route', async () => {
    let serveDetailCalls = 0
    api.mock('GET /v1/outreach/serve/:id', ({ params }) => {
      serveDetailCalls += 1
      expect(params.id).toBe('77')
      return { status: 200, data: savedDetail }
    })

    const outreaches: HistoryRow[] = [
      {
        id: 77,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduction posts',
        status: 'completed',
      },
    ]
    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    await user.click(table.getByText('Introduction posts'))

    // Only the serve detail route is mocked — if the drawer called the Win
    // route instead, this fetch would go unmocked and the query would error.
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()
    expect(serveDetailCalls).toBeGreaterThan(0)
    expect(
      screen.queryByText(/couldn't load this campaign's posts/),
    ).not.toBeInTheDocument()
  })

  it('archives a saved social row from the drawer', async () => {
    api.mock('GET /v1/outreach/serve/:id', {
      status: 200,
      data: savedDetail,
    })
    let archiveBody: unknown
    api.mock('PATCH /v1/outreach/:id/archive', ({ params, body }) => {
      archiveBody = body
      expect(params.id).toBe('77')
      return {
        status: 200,
        data: { id: 77, archivedAt: new Date('2026-08-30T00:00:00Z') },
      }
    })

    const outreaches: HistoryRow[] = [
      {
        id: 77,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduction posts',
        status: 'completed',
      },
    ]
    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    await user.click(table.getByText('Introduction posts'))

    await user.click(
      await screen.findByRole('button', { name: 'Move to archive' }),
    )

    expect(archiveBody).toEqual({ archived: true })
  })

  const serveCreateResponse = {
    id: 5,
    name: 'Introduction calls',
    sheetCount: 1,
    entryCount: 10,
    personCount: 10,
    outreachId: 88,
    hasMore: false,
  }

  const mockServePhoneBankingDraft = () => {
    const calls: ServePhoneBankingScriptDraftRequest[] = []
    api.mock('POST /v1/outreach/serve/phone-banking/draft', ({ body }) => {
      calls.push(body)
      return { status: 200, data: { draft: `AI script for ${body.purpose}` } }
    })
    return calls
  }

  // Drives the serve phone banking flow purpose -> who -> script -> sheets,
  // stopping right before the sheets step's Continue (the create call).
  const advanceServePhoneBankingToSheets = async () => {
    await user.click(screen.getByText('Phone banking'))
    await user.click(
      await screen.findByText('Introduce myself to constituents'),
    )
    await user.click(await screen.findByText('Choose a voter list'))
    await user.click(await screen.findByText('Downtown constituents'))
    await user.click(
      await screen.findByRole('button', { name: /Continue \(10\)/ }),
    )
    await screen.findAllByText('Write your call script')
    await waitFor(() =>
      expect(screen.getByLabelText('Call script')).not.toHaveValue(''),
    )
    await user.type(screen.getByLabelText('Campaign name'), 'Maple calls')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )
  }

  it('onSaved seeds the new phone banking row into history without a page reload', async () => {
    mockPhoneBankingAudience()
    mockServePhoneBankingDraft()
    const createCalls: ServePhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/serve/lists', ({ body }) => {
      createCalls.push(body)
      return { status: 200, data: serveCreateResponse }
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    await advanceServePhoneBankingToSheets()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      (await screen.findAllByText('Your call sheet is ready')).length,
    ).toBeGreaterThan(0)
    expect(createCalls).toHaveLength(1)

    // Seeded via state (handlePhoneBankingSaved), not a list refetch — found
    // even while the flow sheet still occupies the accessibility tree. Both
    // the desktop table and the mobile card list render it.
    expect(await screen.findAllByText('Introduction calls')).toHaveLength(2)
  })

  it('clicking a saved phone banking row opens the drawer against the serve detail route', async () => {
    const savedPhoneBankingDetail = {
      ...savedDetail,
      id: 88,
      outreachType: 'nativePhoneBanking' as const,
      name: 'Introduction calls',
      phoneBanking: {
        listId: 5,
        entriesTotal: 10,
        entriesCalled: 4,
        peopleTotal: 10,
        peopleCalled: 4,
        byOutcome: {
          answered: 4,
          no_answer: 0,
          voicemail: 0,
          wrong_number: 0,
          refused: 0,
          disconnected: 0,
          hung_up: 0,
        },
        supporters: 2,
        unsure: 1,
        nonSupporters: 1,
        byFollowUp: { yes: 0, no: 0 },
      },
    }
    let serveDetailCalls = 0
    api.mock('GET /v1/outreach/serve/:id', ({ params }) => {
      serveDetailCalls += 1
      expect(params.id).toBe('88')
      return { status: 200, data: savedPhoneBankingDetail }
    })

    const outreaches: HistoryRow[] = [
      {
        id: 88,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'nativePhoneBanking',
        name: 'Introduction calls',
        status: 'in_progress',
      },
    ]
    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    await user.click(table.getByText('Introduction calls'))

    // Only the serve detail route is mocked — if the drawer called the Win
    // route instead, this fetch would go unmocked and the query would error.
    expect(await screen.findByText('4 of 10 reached')).toBeInTheDocument()
    expect(serveDetailCalls).toBeGreaterThan(0)
    expect(
      screen.queryByText(/couldn't load this campaign's call progress/),
    ).not.toBeInTheDocument()
  })
})

// The flag is the only thing between this page and a live paid channel, so
// all three of its states are asserted rather than just the happy one.
describe('ConstituentOutreachPage — the serve-sms-outreach gate', () => {
  afterEach(() => {
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = false
  })

  it('shows no SMS card and no way in while the flag is off', () => {
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = false

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /SMS/ }),
    ).not.toBeInTheDocument()
    // The three ungated cards, and nothing else to press.
    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Phone banking')).toBeInTheDocument()
    expect(screen.getByText('Door knocking')).toBeInTheDocument()
    // The flow is not merely closed — it is not in the tree at all, so no
    // Serve SMS request is reachable from this page by any route.
    expect(
      screen.queryByText(
        'This helps us draft the right message for your constituents.',
      ),
    ).not.toBeInTheDocument()
  })

  // The anti-pattern this guards: `enabled` alone is falsy-then-true while
  // the variant resolves, so a page that ignores `ready` renders three cards
  // and then pops a fourth in. An unresolved flag must look exactly like an
  // off one.
  it('shows no SMS card while the flag is still resolving, even if it will be on', () => {
    serveSmsFlag.ready = false
    serveSmsFlag.enabled = true

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(screen.queryByText('SMS')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Social media/ }).length).toBe(
      1,
    )
  })

  it('shows the SMS card and opens the serve SMS flow when the flag is on', async () => {
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = true

    render(<ConstituentOutreachPage outreaches={[]} />)

    await user.click(screen.getByText('SMS'))

    // SERVE_SMS_SURFACE's own intro body — Win's reads "the best message for
    // your campaign", which an elected official does not have.
    expect(
      await screen.findByText(
        'This helps us draft the right message for your constituents.',
      ),
    ).toBeInTheDocument()
    // A serve-only purpose card, from SERVE_SMS_PURPOSES.
    expect(screen.getByText('Explain a recent decision')).toBeInTheDocument()
  })
})

// Door knocking leaves this page and comes back to it, and the row it wrote
// while away has to be here. See `OutreachHubPage.test.tsx` for the Win half
// of the same fix.
describe('ConstituentOutreachPage — the mount refresh', () => {
  it('asks the server once on mount, so a campaign made while away appears', async () => {
    // The seeded snapshot predates the campaign: the refetch is the only
    // thing that can put it on the table, because this route's RSC may not
    // have re-run on the way back.
    api.mock('GET /v1/outreach/serve', {
      status: 200,
      data: [
        {
          id: 1,
          date: '2026-08-20',
          outreachType: 'socialMedia',
          name: 'Budget update post',
          status: 'completed',
        },
        {
          id: 2,
          date: '2026-09-29',
          outreachType: 'nativeDoorKnocking',
          name: 'Introduction walk',
          status: 'in_progress',
        },
      ],
    })

    render(
      <ConstituentOutreachPage
        outreaches={[
          {
            id: 1,
            date: '2026-08-20',
            outreachType: 'socialMedia',
            name: 'Budget update post',
            status: 'completed',
          },
        ]}
      />,
    )

    expect(
      await within(desktopTable()).findByText('Introduction walk'),
    ).toBeInTheDocument()
  })
})

// A chat card hands its proposal to this page through the same handoff the
// Chief of Staff uses for social: `?compose=<channel>&handoff=<nonce>`, with
// the message and the list in sessionStorage.
describe('ConstituentOutreachPage — a chat card proposal', () => {
  const SCRIPT = 'Calling about the Maple Street drains.'
  const PROPOSAL_KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7'

  const arriveWith = (params: string, payload?: object) => {
    if (payload) {
      sessionStorage.setItem('cos-handoff-n1', JSON.stringify(payload))
    }
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(params) as ReturnType<typeof useSearchParams>,
    )
  }

  afterEach(() => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as ReturnType<typeof useSearchParams>,
    )
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = false
    sessionStorage.clear()
  })

  it('opens phone banking past the purpose, on the list, with the script written', async () => {
    mockPhoneBankingAudience()
    arriveWith('compose=phoneBanking&handoff=n1', {
      channel: 'phoneBanking',
      message: SCRIPT,
      savedFilterId: 3,
      name: 'Maple Street households',
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(
      await screen.findAllByRole('heading', {
        name: 'Who do you want to reach?',
      }),
    ).not.toHaveLength(0)
    expect(
      screen.queryByText('Introduce myself to constituents'),
    ).not.toBeInTheDocument()

    const next = await screen.findByRole('button', { name: 'Continue' })
    await waitFor(() => expect(next).toBeEnabled())
    await user.click(next)
    expect(await screen.findByDisplayValue(SCRIPT)).toBeInTheDocument()

    // The flow's own create carries the proposal link, which is what links
    // the list to its priority and makes a second completion idempotent.
    const bodies: ServePhoneBankingCreate[] = []
    api.mock('POST /v1/phone-banking/serve/lists', ({ body }) => {
      bodies.push(body)
      return {
        status: 200,
        data: {
          id: 9,
          name: 'Calls',
          sheetCount: 1,
          entryCount: 1,
          personCount: 1,
          outreachId: 90,
          hasMore: false,
        },
      }
    })
    // Named from the proposal, so the script step does not stop on an empty
    // required field, and still editable.
    expect(screen.getByLabelText('Campaign name')).toHaveValue(
      'Maple Street households',
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findAllByText(
      'How many call sheets would you like me to create?',
    )
    const create = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(create).toBeEnabled())
    await user.click(create)
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      name: 'Maple Street households',
      script: SCRIPT,
      voterFileFilterId: 3,
      proposalKey: PROPOSAL_KEY,
      priorityId: 'priority-1',
    })

    expect(router.replace).toHaveBeenCalledWith(
      '/dashboard/constituent-outreach',
      { scroll: false },
    )
    // Spent on arrival, so a reload does not reopen it.
    expect(sessionStorage.getItem('cos-handoff-n1')).toBeNull()
  })

  it('opens text on its audience step with the message carried in', async () => {
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = true
    arriveWith('compose=text&handoff=n1', {
      channel: 'text',
      message: SCRIPT,
      savedFilterId: 3,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(
      await screen.findAllByRole('heading', {
        name: 'Who do you want to reach?',
      }),
    ).not.toHaveLength(0)
    expect(
      screen.queryByText('Explain a recent decision'),
    ).not.toBeInTheDocument()
  })

  it('opens nothing for a payload that names another channel', () => {
    mockPhoneBankingAudience()
    arriveWith('compose=phoneBanking&handoff=n1', {
      channel: 'text',
      message: SCRIPT,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(
      screen.queryAllByRole('heading', { name: 'Who do you want to reach?' }),
    ).toHaveLength(0)
  })

  it('opens a send on its own row when a card links to it', async () => {
    api.mock('GET /v1/outreach/serve/:id', { status: 200, data: savedDetail })
    arriveWith('outreachId=77')

    render(
      <ConstituentOutreachPage
        outreaches={[
          {
            id: 77,
            createdAt: '2026-08-30T00:00:00Z',
            outreachType: 'socialMedia',
            name: 'Introduction posts',
            status: 'completed',
          },
        ]}
      />,
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('consumes a later link to the same send again', async () => {
    api.mock('GET /v1/outreach/serve/:id', { status: 200, data: savedDetail })
    const rows: HistoryRow[] = [
      {
        id: 77,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduction posts',
        status: 'completed',
      },
    ]
    vi.mocked(router.replace!).mockClear()
    arriveWith('outreachId=77')
    const { rerender } = render(<ConstituentOutreachPage outreaches={rows} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    // router.replace strips the param, then the same chip is pressed again
    // (the chat dock is mounted on this page too).
    arriveWith('')
    rerender(<ConstituentOutreachPage outreaches={rows} />)
    arriveWith('outreachId=77')
    rerender(<ConstituentOutreachPage outreaches={rows} />)

    await waitFor(() =>
      expect(
        vi
          .mocked(router.replace!)
          .mock.calls.filter(
            ([path]) => path === '/dashboard/constituent-outreach',
          ),
      ).toHaveLength(2),
    )
  })

  it('waits for the SMS flag to settle before spending a text handoff', async () => {
    serveSmsFlag.ready = false
    serveSmsFlag.enabled = false
    arriveWith('compose=text&handoff=n1', {
      channel: 'text',
      message: SCRIPT,
      savedFilterId: 3,
    })

    const { rerender } = render(<ConstituentOutreachPage outreaches={[]} />)
    expect(sessionStorage.getItem('cos-handoff-n1')).not.toBeNull()

    serveSmsFlag.ready = true
    serveSmsFlag.enabled = true
    rerender(<ConstituentOutreachPage outreaches={[]} />)

    expect(
      await screen.findAllByRole('heading', {
        name: 'Who do you want to reach?',
      }),
    ).not.toHaveLength(0)
    expect(sessionStorage.getItem('cos-handoff-n1')).toBeNull()
  })

  it('leaves a text handoff unspent while SMS is off here', () => {
    serveSmsFlag.ready = true
    serveSmsFlag.enabled = false
    arriveWith('compose=text&handoff=n1', {
      channel: 'text',
      message: SCRIPT,
      savedFilterId: 3,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(sessionStorage.getItem('cos-handoff-n1')).not.toBeNull()
    expect(
      screen.queryAllByRole('heading', { name: 'Who do you want to reach?' }),
    ).toHaveLength(0)
  })

  it('opens social on the draft a card proposed', async () => {
    arriveWith('compose=social&handoff=n1', {
      channel: 'social',
      message: SCRIPT,
      proposalKey: PROPOSAL_KEY,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(await screen.findByDisplayValue(SCRIPT)).toBeInTheDocument()
  })
})
