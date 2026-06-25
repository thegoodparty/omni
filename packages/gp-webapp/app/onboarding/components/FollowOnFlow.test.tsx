import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import FollowOnFlow from './FollowOnFlow'

const eligibility = (reelectionOfficeSlug: string | null) => ({
  hasActiveCampaign: false,
  holdsOffice: Boolean(reelectionOfficeSlug),
  canStartCampaign: true,
  canGainOffice: false,
  reelectionOfficeSlug,
})

const heldOfficeOrg = {
  slug: 'eo-1',
  name: 'City Council Member',
  positionName: 'City Council Member',
  position: null,
  district: null,
  electedOfficeId: 'eo-1',
  campaignId: null,
  status: 'active' as const,
}

beforeEach(() => {
  api.reset()
  // vitest.setup already clears this between tests; kept explicit so this
  // file's eligibility-driven assertions never read a prior test's cache.
  testQueryClient.clear()
})

describe('FollowOnFlow', () => {
  it('lands on welcome with no intent screen (same-office)', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    // The switcher action is the intent — re-election goes straight to welcome
    // rather than re-asking on an intent screen.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /set up your new campaign/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("I'm running for the same office"),
    ).not.toBeInTheDocument()
  })

  it('exits to the dashboard when Back is clicked on the first step', async () => {
    vi.mocked(router.push!).mockClear()
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    const backButton = await screen.findByRole('button', { name: /back/i })
    // The first step has no in-flow predecessor, so Back leaves the flow
    // rather than trapping the user on it.
    expect(backButton).toBeEnabled()
    fireEvent.click(backButton)
    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('lands on welcome for a new-office candidate', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility(null) })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [] },
    })

    render(<FollowOnFlow intent="new-office" />)

    // Lands on the first standard step (welcome), not the intent screen.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /set up your new campaign/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("I'm running for the same office"),
    ).not.toBeInTheDocument()
  })

  it('creates the new campaign via follow-on with the same-office payload', async () => {
    let followOnBody: unknown = null
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    api.mock('POST /v1/campaigns/follow-on', (request) => {
      followOnBody = request.body
      // The minimal Campaign fields FollowOnFlow reads after creation.
      return { status: 200, data: { id: 4242, slug: 'campaign-4242' } as never }
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })
    fireEvent.click(continueButton)

    await waitFor(() => expect(followOnBody).not.toBeNull())
    expect(followOnBody).toEqual({
      intent: 'same-office',
      fromOrganizationSlug: 'eo-1',
    })

    // Back is locked after creation so the user can't return and undo it on an
    // already-created campaign.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /back/i })).toBeDisabled(),
    )
  })

  it('keeps Back disabled while the follow-on create is in flight', async () => {
    let resolvePost!: (value: { status: number; data: never }) => void
    const postGate = new Promise<{ status: number; data: never }>(
      (resolve) => {
        resolvePost = resolve
      },
    )
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    // Suspend the create so the isCreating window (liveCampaign still null) is
    // observable: Back must be disabled then, or a first-step exit would
    // abandon the session mid-creation.
    api.mock('POST /v1/campaigns/follow-on', () => postGate)

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    const backButton = await screen.findByRole('button', { name: /back/i })
    // Enabled before the create starts (first step exits to the dashboard).
    expect(backButton).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // In flight liveCampaign is still null, so this exercises the isCreating
    // branch of the disabled guard specifically.
    await waitFor(() => expect(backButton).toBeDisabled())

    resolvePost({
      status: 200,
      data: { id: 4242, slug: 'campaign-4242' } as never,
    })
    // Still disabled after creation (now via liveCampaign).
    await waitFor(() => expect(backButton).toBeDisabled())
  })

  it('inherits the held office from eligibility for same-office without ?from=', async () => {
    let followOnBody: unknown = null
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    api.mock('POST /v1/campaigns/follow-on', (request) => {
      followOnBody = request.body
      return { status: 200, data: { id: 4242, slug: 'campaign-4242' } as never }
    })

    // Direct ?intent=same-office URL with no ?from=: the flow backfills the held
    // office from eligibility (reelectionOfficeSlug) so the same-office run still
    // inherits the position rather than 400ing on a missing source org.
    render(<FollowOnFlow intent="same-office" />)

    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })
    // Continue is gated until the slug backfills from eligibility.
    await waitFor(() => expect(continueButton).toBeEnabled())
    fireEvent.click(continueButton)

    await waitFor(() => expect(followOnBody).not.toBeNull())
    expect(followOnBody).toEqual({
      intent: 'same-office',
      fromOrganizationSlug: 'eo-1',
    })
  })

  it('keeps Continue disabled for same-office when no held-office slug resolves', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility(null) })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [] },
    })

    // No ?from= and no reelectionOfficeSlug to backfill from (e.g. the
    // eligibility lookup resolved nothing): Continue must stay disabled rather
    // than firing a follow-on the server would 400. Back still exits the flow.
    render(<FollowOnFlow intent="same-office" />)

    expect(
      await screen.findByRole('button', { name: /continue/i }),
    ).toBeDisabled()
  })

  it('recovers from a 409 by resuming on the existing campaign', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    // A retry after the campaign already exists (e.g. a refresh re-fired
    // creation): the server 409s, and the flow resumes on the existing
    // campaign rather than dead-ending. 409 isn't in the typed mocker's status
    // union, so register it as a raw handler.
    mswServer.use(
      http.post('/api/v1/campaigns/follow-on', () =>
        HttpResponse.json(
          { message: 'already has an active campaign' },
          { status: 409 },
        ),
      ),
    )
    api.mock('GET /v1/campaigns/mine', {
      status: 200,
      data: { id: 99, slug: 'campaign-99' } as never,
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))

    // Advances to the next step (ballot-status) with no error surfaced.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /already on the ballot/i,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces an error when follow-on creation fails', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    api.mock('POST /v1/campaigns/follow-on', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /something went wrong creating your campaign/i,
    )
  })

  it('surfaces an actionable message when the office has no upcoming election', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })
    // The server refuses a same-office run it can't date (400). 400 isn't in
    // the typed mocker's status union, so register it as a raw handler.
    mswServer.use(
      http.post('/api/v1/campaigns/follow-on', () =>
        HttpResponse.json(
          {
            message: 'Could not determine the next election date',
            errorCode: 'UNRESOLVED_ELECTION_DATE',
          },
          { status: 400 },
        ),
      ),
    )

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't find an upcoming election for this office/i,
    )
  })

  it('blocks continue on party affiliation when a major party is selected', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility(null) })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [] },
    })

    render(<FollowOnFlow intent="new-office" />)

    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })
    // welcome -> ballot-status
    fireEvent.click(continueButton)
    fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
    // ballot-status -> party-affiliation
    fireEvent.click(continueButton)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /party designation/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/democrat/i))
    expect(continueButton).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /only for non-partisan and independent candidates/i,
    )

    fireEvent.click(screen.getByLabelText(/nonpartisan race/i))
    expect(continueButton).toBeEnabled()
  })
})
