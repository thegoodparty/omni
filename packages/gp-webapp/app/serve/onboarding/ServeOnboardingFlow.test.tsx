import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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

import ServeOnboardingFlow from './ServeOnboardingFlow'

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
  })

  it('starts a net-new lead (no saved answers) at the welcome step', async () => {
    mockLoad(buildEO(), buildOrg())
    renderFlow()

    expect(
      await screen.findByText('Meet your virtual chief of staff in 5 minutes'),
    ).toBeInTheDocument()
  })

  it('resumes a returning lead with a saved party past the welcome/inOffice intro', async () => {
    // Genuine prefill (BR term dates present) + party answered, office still to
    // be confirmed → resumes on the confirm hub, NOT welcome.
    mockLoad(
      buildEO({
        party: 'independent',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      }),
      buildOrg(),
    )
    renderFlow()

    expect(await screen.findByText('Does this look right?')).toBeInTheDocument()
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

    await screen.findByText('Does this look right?')
    // confirm → party → inOffice
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
    // record started net-new, so the first user-driven write stamps it), and no
    // onboardingCompletedAt — the completion guard stays untouched. Then it
    // advances to the office step.
    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody).toEqual({ party: 'independent', selfReported: true })
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
    const [startInput, endInput] = screen.getAllByPlaceholderText('mm/dd/yyyy')
    await user.type(startInput!, '01012026')
    await user.type(endInput!, '01012030')
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
    // genuine sales/BR prefill, so it must resume on the confirm hub (prefill
    // branch), which is exactly the path that arms the BR suggestion-accuracy
    // snapshot. Previously this shape was forced to net-new and the snapshot
    // was silently dropped.
    mockLoad(
      buildEO({ party: 'independent', selfReported: false }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    renderFlow()

    expect(await screen.findByText('Does this look right?')).toBeInTheDocument()
    expect(
      screen.queryByText('When does your term run?'),
    ).not.toBeInTheDocument()
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
    expect(putBody).toEqual({ party: 'independent' })
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

  it('POSTs a new EO with selfReported when a net-new user with no prior record completes', async () => {
    // No existing EO: `/current` 404s and `/mine` is empty, so `currentEO`
    // stays null and persist() takes the POST branch. The party-step
    // incremental save is a no-op (nothing to attach to), so the completion
    // POST is the only place selfReported is recorded for this user — it must
    // carry the marker so resume never misclassifies them as a prefill.
    let postBody: Record<string, unknown> | undefined
    api.mock('GET /v1/elected-office/current', { status: 404, data: {} })
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] })
    api.mock('POST /v1/elected-office', (req) => {
      postBody = req.body as unknown as Record<string, unknown>
      return {
        status: 200,
        data: buildEO({ id: 'eo-new', selfReported: true }),
      }
    })

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

      await screen.findByText('What office do you currently hold?')
      await user.type(
        screen.getByPlaceholderText('Enter 5 digit zip code'),
        '90001',
      )
      await user.click(screen.getByRole('button', { name: 'Search' }))
      await user.click(await screen.findByRole('radio', { name: /Mayor/ }))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText('When does your term run?')
      const [startInput, endInput] =
        screen.getAllByPlaceholderText('mm/dd/yyyy')
      await user.type(startInput!, '01012026')
      await user.type(endInput!, '01012030')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText(
        "Here's everything to know about your constituents",
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByText('Take our pledge to get your chief of staff')
      await user.click(screen.getByRole('button', { name: 'Agree & Continue' }))

      await waitFor(() => expect(postBody).toBeDefined())
      expect(postBody).toMatchObject({ selfReported: true })
      // Completion still stamps onboardingCompletedAt (the existing guard), and
      // the marker rides alongside it.
      expect(postBody).toHaveProperty('onboardingCompletedAt')
    } finally {
      testQueryClient.removeQueries({ queryKey: positionsKey })
    }
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
