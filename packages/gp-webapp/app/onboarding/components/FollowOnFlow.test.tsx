import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
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
})

describe('FollowOnFlow', () => {
  it('renders the intent screen with the held office name (same-office)', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })

    render(<FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /re-election in City Council Member/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("I'm running for the same office"),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/same office/i)).toBeChecked()
  })

  it('skips the intent screen for a candidate with no held office', async () => {
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
  })

  it('disables continue for same-office without a held-office slug', async () => {
    api.mock('GET /v1/eligibility', { status: 200, data: eligibility('eo-1') })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [heldOfficeOrg] },
    })

    // Direct ?intent=same-office URL with no ?from=: Continue must stay
    // disabled rather than firing a request the server would 400 (Back is
    // disabled on this first step, so there'd be no way out).
    render(<FollowOnFlow intent="same-office" />)

    expect(
      await screen.findByRole('button', { name: /continue/i }),
    ).toBeDisabled()
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
