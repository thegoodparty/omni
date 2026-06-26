import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import { SnackbarProvider } from '@shared/utils/Snackbar'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'

// Analytics fans out to Segment on a real window; stub it so the flow's
// trackServeOnboarding calls are inert in jsdom.
vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual = await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

import { trackEvent } from 'helpers/analyticsHelper'
import ServeOnboardingFlow from './ServeOnboardingFlow'

const trackEventMock = vi.mocked(trackEvent)

// Properties passed to a given event name across all trackEvent calls (the flow
// fires through trackServeOnboarding → trackEvent).
const eventProps = (name: string): Record<string, unknown>[] =>
  trackEventMock.mock.calls
    .filter(([eventName]) => eventName === name)
    .map(([, props]) => (props ?? {}) as Record<string, unknown>)

const EO_ID = 'eo-uuid-1'

const buildEO = (overrides: Partial<ElectedOffice> = {}): ElectedOffice => ({
  id: EO_ID,
  swornInDate: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
  termLengthDays: null,
  isActive: false,
  party: null,
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: null,
  campaignId: null,
  ...overrides,
})

const buildOrg = (overrides: Partial<Organization> = {}): Organization =>
  ({
    slug: `eo-${EO_ID}`,
    positionName: null,
    position: null,
    district: null,
    electedOfficeId: EO_ID,
    campaignId: null,
    status: 'active',
    ...overrides,
  }) as Organization

const renderFlow = () =>
  render(
    <SnackbarProvider>
      <ServeOnboardingFlow />
    </SnackbarProvider>,
  )

// The term-date fields are popover date pickers (a labelled trigger button that
// opens a calendar with month/year dropdowns), not free-text inputs. Drive one
// the way a user would: open its popover, navigate via the dropdowns, then click
// the day cell. Day buttons carry `data-day` (the locale date string), so we
// match the exact day directly instead of an ambiguous "1".
const pickTermDate = async (
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
  date: Date,
) => {
  await user.click(screen.getByLabelText(fieldLabel))
  const dialog = await screen.findByRole('dialog')
  // The month/year dropdowns each re-render the calendar (and replace the
  // <select> nodes) on change, so re-query before driving each one. Set the
  // year first, then the month, to land on the target month grid.
  const yearSelect = within(dialog).getAllByRole('combobox')[1]
  await user.selectOptions(yearSelect!, String(date.getFullYear()))
  const monthSelect = within(dialog).getAllByRole('combobox')[0]
  await user.selectOptions(
    monthSelect!,
    date.toLocaleString('default', { month: 'short' }),
  )
  // Day buttons carry the locale date string in data-day; the day cell uses the
  // ISO form, so scope to the button to pick the exact day unambiguously.
  const dayButton = dialog.querySelector(
    `button[data-day="${date.toLocaleDateString()}"]`,
  )
  await user.click(dayButton as HTMLElement)
  // The popover closes once a day is picked.
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
}

// Fills both term-date pickers with the canonical 2026-01-01 → 2030-01-01 range
// the term-dates tests assert on.
const fillTermDates = async (
  user: ReturnType<typeof userEvent.setup>,
  start = new Date(2026, 0, 1),
  end = new Date(2030, 0, 1),
) => {
  await pickTermDate(user, 'Term start date', start)
  await pickTermDate(user, 'Term end date', end)
}

// Mocks the three GETs the load effect fires. `eo` is returned for both
// `current` and `mine` so the flow adopts it (rather than treating the user as
// net-new with no record).
const mockLoad = (eo: ElectedOffice, org: Organization) => {
  api.mock('GET /v1/elected-office/current', { status: 200, data: eo })
  api.mock('GET /v1/elected-office/mine', { status: 200, data: [eo] })
  api.mock('GET /v1/organizations/:slug', { status: 200, data: org })
}

describe('ServeOnboardingFlow', () => {
  beforeEach(() => {
    api.reset()
    trackEventMock.mockClear()
  })

  it('starts a net-new lead (no saved answers) at the welcome step', async () => {
    mockLoad(buildEO(), buildOrg())
    renderFlow()

    expect(
      await screen.findByText('Meet your virtual chief of staff in 5 minutes'),
    ).toBeInTheDocument()
  })

  it('resumes a returning lead with a saved party past the welcome/inOffice intro', async () => {
    // Genuine prefill (BR term dates present) + party answered, but the office
    // is still missing. Prompt-first gating routes the user to fill the office
    // FIRST (not the confirm hub, and not welcome) so confirm is never shown
    // with a missing piece.
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      }),
      buildOrg(),
    )
    renderFlow()

    expect(
      await screen.findByText('What office do you currently hold?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Does this look right?')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Meet your virtual chief of staff in 5 minutes'),
    ).not.toBeInTheDocument()
  })

  it('seeds inOffice on resume so backing up to the inOffice step is not a dead end', async () => {
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      }),
      buildOrg(),
    )
    const user = userEvent.setup()
    renderFlow()

    // Prompt-first routing lands on the office step (office still missing).
    // Backing out of a prompt-first detour returns to the prior real step:
    // office → party → inOffice.
    await screen.findByText('What office do you currently hold?')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText("What's your party designation?")
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(
      await screen.findByText('Are you already in office?'),
    ).toBeInTheDocument()
    // Continue is enabled because inOffice was seeded from the persisted party,
    // rather than left null (which would trap forward progress).
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('persists the party answer (and stamps selfReported) with a partial PUT when leaving the party step', async () => {
    let putBody: Record<string, unknown> | undefined
    mockLoad(buildEO(), buildOrg())
    api.mock('PUT /v1/elected-office/:id', (req) => {
      putBody = req.body as unknown as Record<string, unknown>
      return { status: 200, data: buildEO({ party: 'independent' }) }
    })

    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm an elected official/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', {
        name: /Independent \/ Non-major party/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // The partial PUT carries party plus the net-new `selfReported` marker (the
    // record started net-new, so the first user-driven write stamps it) and the
    // `office` step checkpoint, and no onboardingCompletedAt — the completion
    // guard stays untouched. Then it advances to the office step.
    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody).toEqual({
      party: 'independent',
      selfReported: true,
      onboardingStep: 'office',
    })
    expect(putBody).not.toHaveProperty('onboardingCompletedAt')
    expect(
      await screen.findByText('What office do you currently hold?'),
    ).toBeInTheDocument()
  })

  // Resume directly onto the net-new office step (party saved, no office /
  // term dates yet), then pick an office and reach the term-dates step. Shared
  // setup for the two term-dates Continue-path tests below.
  const reachTermDatesStep = async () => {
    mockLoad(buildEO({ party: 'independent' }), buildOrg())
    api.mock('PATCH /v1/organizations/:slug', {
      status: 200,
      data: buildOrg(),
    })
    // ServeOfficePicker fetches positions via the legacy clientFetch route
    // (not a typed clientRequest), so match it with a raw msw handler.
    mswServer.use(
      http.get('*/elections/races-by-year', () =>
        HttpResponse.json([
          {
            brPositionId: 'br-pos-1',
            position: { id: 'p1', name: 'Mayor', level: 'City', state: 'CA' },
            city: 'Springfield',
          },
        ]),
      ),
    )

    const user = userEvent.setup()
    renderFlow()

    // Net-new resume with a saved party lands on the office step.
    await screen.findByText('What office do you currently hold?')
    await user.type(
      screen.getByPlaceholderText('Enter 5 digit zip code'),
      '90001',
    )
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('radio', { name: /Mayor/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('When does your term run?')
    await fillTermDates(user)
    return user
  }

  it('persists term dates and advances to constituents on the term-dates step', async () => {
    let putBody: Record<string, unknown> | undefined
    mockLoad(buildEO({ party: 'independent' }), buildOrg())
    api.mock('PATCH /v1/organizations/:slug', {
      status: 200,
      data: buildOrg(),
    })
    api.mock('PUT /v1/elected-office/:id', (req) => {
      putBody = req.body as unknown as Record<string, unknown>
      return { status: 200, data: buildEO({ party: 'independent' }) }
    })

    const user = await reachTermDatesStep()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody).toEqual({
      termStartDate: '2026-01-01',
      termEndDate: '2030-01-01',
      onboardingStep: 'constituents',
    })
    expect(putBody).not.toHaveProperty('onboardingCompletedAt')
    expect(
      await screen.findByText(
        "Here's everything to know about your constituents",
      ),
    ).toBeInTheDocument()
  })

  it('still advances to constituents when the term-dates save fails', async () => {
    mockLoad(buildEO({ party: 'independent' }), buildOrg())
    api.mock('PATCH /v1/organizations/:slug', {
      status: 200,
      data: buildOrg(),
    })
    api.mock('PUT /v1/elected-office/:id', {
      status: 500,
      data: { message: 'boom' },
    })

    const user = await reachTermDatesStep()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // saveThenAdvance swallows the failed PUT; the chained goToConstituents
    // still runs, so the user reaches the constituents step.
    expect(
      await screen.findByText(
        "Here's everything to know about your constituents",
      ),
    ).toBeInTheDocument()
  })

  it('keeps a self-reported net-new user (marker set) in the net-new branch on resume', async () => {
    // selfReported marks the office as the user's own net-new pick, so even
    // though it now sits on the org with no term dates, resume stays net-new:
    // it lands on the term-dates step, NOT the prefill confirm hub (whose
    // "pulled from public records" copy would be wrong for self-entered data).
    mockLoad(
      buildEO({ party: 'independent', selfReported: true }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    renderFlow()

    expect(
      await screen.findByText('When does your term run?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Does this look right?')).not.toBeInTheDocument()
  })

  it('treats a partial prefill (office present, no marker, no dates) as prefill so the snapshot fires', async () => {
    // Same field shape as the net-new case above — office on the org, party
    // answered, no term dates — but WITHOUT the selfReported marker. This is a
    // genuine sales/BR prefill. Prompt-first gating routes to the term-dates
    // step FIRST (instead of the confirm hub with a red error), but it stays in
    // the prefill branch — proven by the term-dates Continue returning to the
    // confirm hub (a net-new user would advance to constituents) — so the BR
    // suggestion-accuracy snapshot is still armed.
    mockLoad(
      buildEO({ party: 'independent', selfReported: false }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO({ party: 'independent' }),
    })
    const user = userEvent.setup()
    renderFlow()

    expect(
      await screen.findByText('When does your term run?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Does this look right?')).not.toBeInTheDocument()

    await fillTermDates(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // The prefill detour returns to the confirm hub once dates are valid.
    expect(await screen.findByText('Does this look right?')).toBeInTheDocument()
  })

  it('shows the confirm hub with its "Why this matters" explainer once office and dates are valid', async () => {
    // Complete prefill resumed via the confirm checkpoint: both office and valid
    // term dates are present, so the confirm hub renders directly (no detour, no
    // red error) alongside its right-rail explainer.
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
        onboardingStep: 'confirm',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    renderFlow()

    expect(await screen.findByText('Does this look right?')).toBeInTheDocument()
    // Item 3: the confirm step's right-rail "Why this matters" box.
    expect(
      screen.getByText(
        'These details ensure we pull the right information and data to help you serve your community',
      ),
    ).toBeInTheDocument()
    // The confirmed office renders as a plain value (the old red error state is
    // gone now that confirm is only shown when complete).
    expect(screen.getByText('Mayor')).toBeInTheDocument()
  })

  it('does not stamp selfReported when answering party in the prefill branch', async () => {
    // A prefill lead (office + dates present, party not yet answered) starts at
    // welcome and reaches the party step in the prefill branch. Its party PUT
    // must NOT carry selfReported, so the record stays classified as prefill.
    let putBody: Record<string, unknown> | undefined
    mockLoad(
      buildEO({
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    api.mock('PUT /v1/elected-office/:id', (req) => {
      putBody = req.body as unknown as Record<string, unknown>
      return { status: 200, data: buildEO({ party: 'independent' }) }
    })

    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm an elected official/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', {
        name: /Independent \/ Non-major party/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(putBody).toBeDefined())
    // Prefill party PUT carries the party + the confirm-hub checkpoint, but NOT
    // the selfReported marker (the record stays classified as a prefill).
    expect(putBody).toEqual({ party: 'independent', onboardingStep: 'confirm' })
    expect(putBody).not.toHaveProperty('selfReported')
  })

  it('advances from the prefill confirm hub to constituents without re-patching the org', async () => {
    // Prefill EO with party + office + term dates all saved resumes at
    // constituents (the confirm review was already passed). Navigate back to
    // the confirm hub, then Continue, to exercise confirm → goToConstituents:
    // the office was never re-picked, so persistOfficeProgress is a no-op and
    // no PATCH should fire.
    const patchRequests: unknown[] = []
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    api.mock('PATCH /v1/organizations/:slug', (req) => {
      patchRequests.push(req)
      return { status: 200, data: buildOrg() }
    })
    // The confirm → constituents Continue still writes the step checkpoint.
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO({ party: 'independent' }),
    })

    const user = userEvent.setup()
    renderFlow()

    await screen.findByText("Here's everything to know about your constituents")
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Does this look right?')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText(
        "Here's everything to know about your constituents",
      ),
    ).toBeInTheDocument()
    // Office was already on the org and never re-picked — no PATCH fires.
    expect(patchRequests).toHaveLength(0)
  })

  it('create-on-first-answer: a net-new user with no EO is created on the inOffice Continue, then checkpoints + completes via PUT', async () => {
    // No existing EO: `/current` 404s and `/mine` is empty, so `currentEO`
    // starts null. The welcome Continue is navigation-only (no EO yet — the user
    // could still pick "campaigning"); the inOffice Continue is the first real
    // answer and must mint the EO (one POST) so every subsequent step has an id
    // to PUT against. Completion is then a PUT (not a duplicate POST) carrying
    // the selfReported marker + onboardingCompletedAt.
    let postCount = 0
    let postBody: Record<string, unknown> | undefined
    const putBodies: Record<string, unknown>[] = []
    api.mock('GET /v1/elected-office/current', { status: 404, data: {} })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] })
    api.mock('POST /v1/elected-office', (req) => {
      postCount += 1
      postBody = req.body as unknown as Record<string, unknown>
      return { status: 200, data: buildEO({ id: 'eo-new' }) }
    })
    api.mock('PUT /v1/elected-office/:id', (req) => {
      putBodies.push(req.body as unknown as Record<string, unknown>)
      return { status: 200, data: buildEO({ id: 'eo-new' }) }
    })
    api.mock('PATCH /v1/organizations/:slug', { status: 200, data: buildOrg() })

    // The office picker fetches positions through the legacy clientFetch path,
    // which only resolves in this fresh-navigate (no-EO) harness when its
    // react-query entry is pre-seeded; seed the result for the ZIP we type so
    // the picker shows the office synchronously.
    const positionsKey = ['serve-onboarding-positions', '90001']
    testQueryClient.setQueryData(positionsKey, [
      {
        brPositionId: 'br-pos-1',
        position: { id: 'p1', name: 'Mayor', level: 'City', state: 'CA' },
        city: 'Springfield',
      },
    ])

    try {
      const user = userEvent.setup()
      renderFlow()

      // Welcome Continue is navigation-only: no EO is created before the user
      // commits to the serve flow.
      await screen.findByText('Meet your virtual chief of staff in 5 minutes')
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByText('Are you already in office?')
      expect(postCount).toBe(0)
      // The inOffice Continue is the first real answer — it mints the EO.
      await user.click(
        await screen.findByRole('button', { name: /I'm an elected official/ }),
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await waitFor(() => expect(postCount).toBe(1))
      await user.click(
        await screen.findByRole('button', {
          name: /Independent \/ Non-major party/,
        }),
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText('What office do you currently hold?')
      await user.type(
        screen.getByPlaceholderText('Enter 5 digit zip code'),
        '90001',
      )
      await user.click(screen.getByRole('button', { name: 'Search' }))
      await user.click(await screen.findByRole('radio', { name: /Mayor/ }))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText('When does your term run?')
      await fillTermDates(user)
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText(
        "Here's everything to know about your constituents",
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText('Take our pledge to get your chief of staff')
      await user.click(screen.getByRole('button', { name: 'Agree & Continue' }))

      // Exactly one create across the whole flow (no duplicate at completion).
      await waitFor(() => expect(putBodies.length).toBeGreaterThan(0))
      expect(postCount).toBe(1)
      // The create-on-first-answer POST is a bare stub (no completion fields).
      expect(postBody).not.toHaveProperty('onboardingCompletedAt')

      // Every post-create Continue wrote a step checkpoint, including a
      // no-data-field step (`constituents`) that data-derived resume can't pinpoint.
      const steps = putBodies.map((b) => b.onboardingStep)
      expect(steps).toContain('party')
      expect(steps).toContain('constituents')

      // Completion is a PUT carrying the marker + onboardingCompletedAt so a
      // net-new user is never misclassified as a prefill on resume.
      const completion = putBodies.find((b) => 'onboardingCompletedAt' in b)
      expect(completion).toBeDefined()
      expect(completion).toMatchObject({
        selfReported: true,
        onboardingStep: 'pledge',
      })
    } finally {
      testQueryClient.removeQueries({ queryKey: positionsKey })
    }
  })

  it('full restart: a returning user resumes at the persisted step checkpoint, even a no-data-field step', async () => {
    // Simulates a fresh navigation after a full restart: GET /current returns
    // the saved record whose onboardingStep checkpoint is `constituents` — a
    // step with no data field that the data-derived resume could only reach by
    // inferring from term dates. The checkpoint drives routing straight there.
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
        selfReported: true,
        onboardingStep: 'constituents',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    renderFlow()

    expect(
      await screen.findByText(
        "Here's everything to know about your constituents",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('When does your term run?'),
    ).not.toBeInTheDocument()
  })

  it('full restart: routes to a persisted inOffice checkpoint when present', async () => {
    // A record carrying an `inOffice` checkpoint with no other data (e.g. a
    // legacy/edge record) must still route there: pure data-derived resume can
    // only ever say `welcome`, so this proves the persisted checkpoint — not the
    // data — drives routing for a no-data-field step.
    mockLoad(buildEO({ onboardingStep: 'inOffice' }), buildOrg())
    renderFlow()

    expect(
      await screen.findByText('Are you already in office?'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Meet your virtual chief of staff in 5 minutes'),
    ).not.toBeInTheDocument()
  })

  it('advances even when the incremental save fails (best-effort, non-blocking)', async () => {
    mockLoad(buildEO(), buildOrg())
    api.mock('PUT /v1/elected-office/:id', {
      status: 500,
      data: { message: 'boom' },
    })

    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm an elected official/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', {
        name: /Independent \/ Non-major party/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // A failed PUT must not strand the user on the party step.
    expect(
      await screen.findByText('What office do you currently hold?'),
    ).toBeInTheDocument()
  })
})

const WELCOME_VIEWED = 'Serve Onboarding - Welcome Viewed'
const OFFICE_STATUS_VIEWED = 'Serve Onboarding - Office Status Viewed'
const PARTY_VIEWED = 'Serve Onboarding - Party Designation Viewed'
const OFFICE_VIEWED = 'Serve Onboarding - Office Viewed'
const OFFICE_COMPLETED = 'Serve Onboarding - Office Completed'
const TERM_DATES_VIEWED = 'Serve Onboarding - Term Dates Viewed'
const CONSTITUENTS_VIEWED = 'Serve Onboarding - Know Your Constituents Viewed'
const CONSTITUENTS_COMPLETED =
  'Serve Onboarding - Know Your Constituents Completed'
const PLEDGE_VIEWED = 'Serve Onboarding - Pledge Viewed'
const PLEDGE_COMPLETED = 'Serve Onboarding - Pledge Completed'
const COMPLETED = 'Serve Onboarding - Net New Completed'
// Events removed in the per-screen rework — asserted absent below.
const STEP_VIEWED = 'Serve Onboarding - Step Viewed'
const SWITCHED = 'Serve Onboarding - Switched to Campaign'

// A net-new lead resumed onto the office step (party saved, no office/dates),
// with the office-picker race lookup and the persistence routes mocked. Returns
// the userEvent once the office step is on screen — shared by the office-step
// analytics tests so they can drive the picker without re-stubbing.
const reachOfficeStepNetNew = async () => {
  mockLoad(buildEO({ party: 'independent' }), buildOrg())
  api.mock('PATCH /v1/organizations/:slug', { status: 200, data: buildOrg() })
  api.mock('PUT /v1/elected-office/:id', {
    status: 200,
    data: buildEO({ party: 'independent' }),
  })
  mswServer.use(
    http.get('*/elections/races-by-year', () =>
      HttpResponse.json([
        {
          brPositionId: 'br-pos-1',
          position: { id: 'p1', name: 'Mayor', level: 'City', state: 'CA' },
          city: 'Springfield',
        },
      ]),
    ),
  )
  const user = userEvent.setup()
  renderFlow()
  await screen.findByText('What office do you currently hold?')
  return user
}

describe('ServeOnboardingFlow analytics instrumentation', () => {
  beforeEach(() => {
    api.reset()
    trackEventMock.mockClear()
  })

  it('fires the Welcome Viewed event once (with branch), deduped across back-and-forth', async () => {
    mockLoad(buildEO(), buildOrg())
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO(),
    })
    const user = userEvent.setup()
    renderFlow()

    // Welcome view fires on view (net-new branch resolved at load).
    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await waitFor(() =>
      expect(eventProps(WELCOME_VIEWED)).toContainEqual(
        expect.objectContaining({ branch: 'net-new' }),
      ),
    )

    // welcome → inOffice → back to welcome → forward to inOffice again.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Are you already in office?')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Are you already in office?')

    // Welcome is logged exactly once despite the re-visit (Set-ref dedupe).
    expect(eventProps(WELCOME_VIEWED)).toHaveLength(1)
    // The legacy generic "Step Viewed" event is gone.
    expect(eventProps(STEP_VIEWED)).toHaveLength(0)
  })

  it('fires Office Status Viewed on Continue with the selected card title (elected official)', async () => {
    mockLoad(buildEO(), buildOrg())
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO(),
    })
    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm an elected official/ }),
    )
    // No event yet — Office Status Viewed fires on Continue, not on selection.
    expect(eventProps(OFFICE_STATUS_VIEWED)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(eventProps(OFFICE_STATUS_VIEWED)).toHaveLength(1),
    )
    expect(eventProps(OFFICE_STATUS_VIEWED)[0]).toEqual(
      expect.objectContaining({
        branch: 'net-new',
        selection: "I'm an elected official",
      }),
    )
  })

  it('captures the "still campaigning" hand-off as the Office Status Viewed selection', async () => {
    mockLoad(buildEO(), buildOrg())
    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm still campaigning/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // The hand-off screen renders, and the office-status selection records the
    // drop-off — the standalone "Switched to Campaign" event is gone.
    await screen.findByText("Let's switch you to campaign mode")
    expect(eventProps(OFFICE_STATUS_VIEWED)).toEqual([
      expect.objectContaining({ selection: "I'm still campaigning" }),
    ])
    expect(eventProps(SWITCHED)).toHaveLength(0)
  })

  it('fires Party Designation Viewed on Continue with the selected party title', async () => {
    mockLoad(buildEO(), buildOrg())
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO({ party: 'independent' }),
    })
    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Meet your virtual chief of staff in 5 minutes')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: /I'm an elected official/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', {
        name: /Independent \/ Non-major party/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(eventProps(PARTY_VIEWED)).toHaveLength(1))
    expect(eventProps(PARTY_VIEWED)[0]).toEqual(
      expect.objectContaining({
        branch: 'net-new',
        selection: 'Independent / Non-major party',
      }),
    )
  })

  it('fires Office Viewed on view and Office Completed on Continue with the chosen office title', async () => {
    const user = await reachOfficeStepNetNew()

    // Office Viewed fires once on view; Office Completed only after a pick.
    await waitFor(() =>
      expect(eventProps(OFFICE_VIEWED)).toContainEqual(
        expect.objectContaining({ branch: 'net-new' }),
      ),
    )
    expect(eventProps(OFFICE_COMPLETED)).toHaveLength(0)

    await user.type(
      screen.getByPlaceholderText('Enter 5 digit zip code'),
      '90001',
    )
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('radio', { name: /Mayor/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('When does your term run?')
    expect(eventProps(OFFICE_COMPLETED)).toEqual([
      expect.objectContaining({ branch: 'net-new', selection: 'Mayor' }),
    ])
    // Term Dates Viewed then fires on view of the next screen.
    expect(eventProps(TERM_DATES_VIEWED)).toHaveLength(1)
  })

  it('fires Know Your Constituents Viewed on view and Completed on Continue', async () => {
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
        selfReported: true,
        onboardingStep: 'constituents',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    api.mock('PATCH /v1/organizations/:slug', { status: 200, data: buildOrg() })
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO({ party: 'independent', selfReported: true }),
    })
    const user = userEvent.setup()
    renderFlow()

    await screen.findByText("Here's everything to know about your constituents")
    await waitFor(() => expect(eventProps(CONSTITUENTS_VIEWED)).toHaveLength(1))
    expect(eventProps(CONSTITUENTS_COMPLETED)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('Take our pledge to get your chief of staff')
    expect(eventProps(CONSTITUENTS_COMPLETED)).toEqual([
      expect.objectContaining({ branch: 'net-new' }),
    ])
    expect(eventProps(PLEDGE_VIEWED)).toHaveLength(1)
  })

  it('fires Pledge Completed and the Net New Completed metric (without a branch prop) at completion', async () => {
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
        selfReported: true,
        onboardingStep: 'pledge',
      }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    api.mock('PATCH /v1/organizations/:slug', { status: 200, data: buildOrg() })
    api.mock('PUT /v1/elected-office/:id', {
      status: 200,
      data: buildEO({ party: 'independent', selfReported: true }),
    })

    const user = userEvent.setup()
    renderFlow()

    await screen.findByText('Take our pledge to get your chief of staff')
    await user.click(screen.getByRole('button', { name: 'Agree & Continue' }))

    await waitFor(() => expect(eventProps(COMPLETED).length).toBeGreaterThan(0))
    // Pledge Completed carries the branch for funnel slicing.
    expect(eventProps(PLEDGE_COMPLETED)).toEqual([
      expect.objectContaining({ branch: 'net-new', electedOfficeId: EO_ID }),
    ])
    // The established Net New Completed metric fires WITHOUT a branch prop (the
    // per-screen rework reverted that addition).
    expect(eventProps(COMPLETED)).toEqual([{ electedOfficeId: EO_ID }])
  })
})
