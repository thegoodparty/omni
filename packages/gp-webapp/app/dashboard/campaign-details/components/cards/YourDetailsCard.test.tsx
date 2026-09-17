import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import type { Campaign, Website } from 'helpers/types'

// The active org decides whether the card is in campaign or elected-office mode.
let mockOrg: { slug?: string; electedOfficeId?: string | null } | undefined
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg,
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
}))

let mockElectedOffice: { id: string; party: string | null } | null
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => ({ data: mockElectedOffice }),
  electedOfficeQueryOptions: (slug?: string) => ({
    queryKey: ['electedOffice', slug],
  }),
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn().mockResolvedValue({}),
}))

vi.mock('app/dashboard/website/util/website.util', async (importActual) => {
  const actual =
    await importActual<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return {
    ...actual,
    getUserWebsite: vi.fn(),
    saveAboutFields: vi.fn().mockResolvedValue(true),
  }
})

vi.mock('gpApi/typed-request', () => ({
  clientRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}))

vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual = await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    infoSnackbar: vi.fn(),
  }),
}))

import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import {
  getUserWebsite,
  saveAboutFields,
} from 'app/dashboard/website/util/website.util'
import { clientRequest } from 'gpApi/typed-request'
import YourDetailsCard from './YourDetailsCard'

const campaign = (details: Record<string, unknown> = {}): Campaign =>
  ({
    id: 1,
    slug: 'campaign-1',
    details,
  }) as unknown as Campaign

const websiteWithBio = (bio: string): Website =>
  ({ content: { about: { bio } } }) as unknown as Website

beforeEach(() => {
  vi.clearAllMocks()
  testQueryClient.clear()
})

describe('YourDetailsCard — candidate (campaign) mode', () => {
  beforeEach(() => {
    mockOrg = { slug: 'campaign-1', electedOfficeId: null }
    mockElectedOffice = null
    vi.mocked(getUserWebsite).mockResolvedValue(websiteWithBio('Original bio'))
  })

  it('displays campaign-sourced details including occupation and website', async () => {
    render(
      <YourDetailsCard
        campaign={campaign({
          party: 'Independent',
          occupation: 'Teacher',
          website: 'https://example.com',
        })}
      />,
    )

    expect(await screen.findByText('Independent')).toBeInTheDocument()
    expect(screen.getByText('Teacher')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    // Bio is sourced from the website record, not the campaign.
    expect(await screen.findByText('Original bio')).toBeInTheDocument()
    expect(screen.getByText('Occupation')).toBeInTheDocument()
    expect(screen.getByText('Website')).toBeInTheDocument()
  })

  it('saves edits to the campaign + website and never touches the elected office', async () => {
    const user = userEvent.setup()
    render(
      <YourDetailsCard
        campaign={campaign({
          party: 'Independent',
          occupation: 'Teacher',
          website: 'https://example.com',
        })}
      />,
    )
    await screen.findByText('Original bio')
    const refetchBaseline = vi.mocked(getUserWebsite).mock.calls.length

    await user.click(screen.getByRole('button', { name: /edit details/i }))

    const occupation = await screen.findByLabelText('Occupation')
    await user.clear(occupation)
    await user.type(occupation, 'Engineer')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCampaign).toHaveBeenCalledTimes(1))
    expect(updateCampaign).toHaveBeenCalledWith([
      { key: 'details.party', value: 'Independent' },
      { key: 'details.occupation', value: 'Engineer' },
      { key: 'details.website', value: 'https://example.com' },
    ])
    // The bio was untouched, so it is not written back. Re-sending an
    // unchanged bio blanked a live one in prod when the website read had
    // silently failed and the field rendered empty.
    expect(saveAboutFields).not.toHaveBeenCalled()

    // Independence: the elected-office endpoint is never called in campaign mode.
    expect(clientRequest).not.toHaveBeenCalled()

    // The website query is invalidated so dependent data refetches.
    await waitFor(() =>
      expect(vi.mocked(getUserWebsite).mock.calls.length).toBeGreaterThan(
        refetchBaseline,
      ),
    )

    // The edited value is reflected in the read-only display.
    expect(await screen.findByText('Engineer')).toBeInTheDocument()
  })

  it('writes the bio when the candidate actually edits it', async () => {
    const user = userEvent.setup()
    render(<YourDetailsCard campaign={campaign({ party: 'Independent' })} />)
    await screen.findByText('Original bio')

    await user.click(screen.getByRole('button', { name: /edit details/i }))

    const bio = await screen.findByLabelText('Bio')
    await user.clear(bio)
    await user.type(bio, 'A rewritten bio')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveAboutFields).toHaveBeenCalledWith({ bio: 'A rewritten bio' }),
    )
  })
})

describe('YourDetailsCard — elected official mode', () => {
  beforeEach(() => {
    mockOrg = { slug: 'eo-1', electedOfficeId: 'eo-1' }
    mockElectedOffice = { id: 'eo-1', party: 'Forward Party' }
    vi.mocked(getUserWebsite).mockResolvedValue(websiteWithBio('EO bio'))
  })

  it('sources party from the elected office and hides campaign-only fields', async () => {
    render(<YourDetailsCard campaign={undefined} />)

    expect(await screen.findByText('Forward Party')).toBeInTheDocument()
    expect(await screen.findByText('EO bio')).toBeInTheDocument()
    // Occupation and Website have no elected-office equivalent.
    expect(screen.queryByText('Occupation')).not.toBeInTheDocument()
    expect(screen.queryByText('Website')).not.toBeInTheDocument()
  })

  it('saves party to the elected office + website and never touches the campaign', async () => {
    const user = userEvent.setup()
    render(<YourDetailsCard campaign={undefined} />)
    await screen.findByText('Forward Party')

    await user.click(screen.getByRole('button', { name: /edit details/i }))

    // Campaign-only inputs are not offered for an elected official.
    expect(screen.queryByLabelText('Occupation')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument()

    const bio = screen.getByLabelText('Bio')
    await user.clear(bio)
    await user.type(bio, 'Updated EO bio')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(clientRequest).toHaveBeenCalledWith('PUT /v1/elected-office/:id', {
        id: 'eo-1',
        party: 'Forward Party',
      }),
    )
    expect(saveAboutFields).toHaveBeenCalledWith({ bio: 'Updated EO bio' })

    // Independence: the campaign update endpoint is never called in EO mode.
    expect(updateCampaign).not.toHaveBeenCalled()
  })
})
