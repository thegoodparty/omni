import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import { SnackbarProvider } from '@shared/utils/Snackbar'
import { render } from 'helpers/test-utils/render'
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
    // Party answered + office prefilled, term dates still missing → prefill
    // branch resumes on the confirm hub, NOT welcome.
    mockLoad(
      buildEO({ party: 'independent' }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
    )
    renderFlow()

    expect(await screen.findByText('Does this look right?')).toBeInTheDocument()
    expect(
      screen.queryByText('Meet your virtual chief of staff in 5 minutes'),
    ).not.toBeInTheDocument()
  })

  it('seeds inOffice on resume so backing up to the inOffice step is not a dead end', async () => {
    mockLoad(
      buildEO({ party: 'independent' }),
      buildOrg({
        positionName: 'Mayor',
        position: { id: 'p1', brPositionId: 'br-1', state: 'CA' },
      }),
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

  it('persists the party answer with a partial PUT when leaving the party step', async () => {
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

    // The partial PUT carries only party (no onboardingCompletedAt, so the
    // completion guard is untouched) and advances to the office step.
    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody).toEqual({ party: 'independent' })
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
