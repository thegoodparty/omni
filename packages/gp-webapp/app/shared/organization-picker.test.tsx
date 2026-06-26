import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { Eligibility, Organization } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { SidebarProvider } from '@styleguide'
import {
  OrganizationProvider,
  OrganizationPicker,
  useOrganization,
} from './organization-picker'

const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: mockRouterPush,
      replace: mockRouterReplace,
    })),
    usePathname: vi.fn(() => '/dashboard'),
  }
})

vi.mock('./experiments/FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(() => ({ on: true })),
}))

vi.mock('@styleguide/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

vi.mock('./layouts/navigation/HeaderLogo', () => ({
  HeaderLogo: () => <div data-testid="header-logo" />,
}))

const mockSetCookie = vi.fn<(name: string, value: string) => void>()
const mockGetCookie = vi.fn<(name: string) => string | false>(() => false)
vi.mock('helpers/cookieHelper', () => ({
  getCookie: (name: string) => mockGetCookie(name),
  setCookie: (name: string, value: string) => mockSetCookie(name, value),
  deleteCookie: vi.fn(),
}))

// Keep EVENTS real (asserting on the registered name strings) but stub the
// network-bound tracker.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const orgs: Organization[] = [
  {
    slug: 'org-one',
    name: 'Organization One',
    positionName: null,
    position: null,
    district: null,
    electedOfficeId: null,
    campaignId: 1,
    status: 'active',
  },
  {
    slug: 'org-two',
    name: 'Organization Two',
    positionName: null,
    position: null,
    district: null,
    electedOfficeId: 'eo-1',
    campaignId: 2,
    status: 'active',
  },
  {
    slug: 'org-three',
    name: 'Organization Three',
    positionName: null,
    position: null,
    district: null,
    electedOfficeId: null,
    campaignId: null,
    status: 'past',
  },
]

beforeEach(() => {
  mockSetCookie.mockClear()
  mockGetCookie.mockReset().mockReturnValue(false)
  mockRouterPush.mockClear()
  mockRouterReplace.mockClear()
  vi.mocked(trackEvent).mockClear()
})

describe('OrganizationProvider', () => {
  it('provides the first organization as default when no initial slug is set', () => {
    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug}</div>
    }

    render(
      <OrganizationProvider initialOrganizations={orgs}>
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('org-one')
  })

  it('selects the org matching the initialSlug prop', () => {
    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug}</div>
    }

    render(
      <OrganizationProvider initialOrganizations={orgs} initialSlug="org-two">
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('org-two')
  })

  it('falls back to the cookie when no initialSlug is provided', () => {
    mockGetCookie.mockImplementation((name: string) =>
      name === 'organization-slug' ? 'org-two' : false,
    )

    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug}</div>
    }

    render(
      <OrganizationProvider initialOrganizations={orgs}>
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('org-two')
  })

  it('falls back to first org when initialSlug does not match any org', () => {
    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug}</div>
    }

    render(
      <OrganizationProvider
        initialOrganizations={orgs}
        initialSlug="nonexistent"
      >
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('org-one')
  })

  it('renders children without context when no organizations exist', () => {
    render(
      <OrganizationProvider initialOrganizations={[]}>
        <div data-testid="child">hello</div>
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('hello')
  })

  it('does not throw when reading electedOfficeId with no organizations (dashboard layout pattern)', () => {
    const Probe = () => {
      const organization = useOrganization()
      const isElectedOffice = !!organization?.electedOfficeId
      return <div data-testid="elected">{String(isElectedOffice)}</div>
    }

    render(
      <OrganizationProvider initialOrganizations={[]}>
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('elected')).toHaveTextContent('false')
  })

  it('resolves the org after initialOrganizations transitions from empty to populated', async () => {
    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug ?? 'none'}</div>
    }

    const { rerender } = render(
      <OrganizationProvider initialOrganizations={[]}>
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('none')

    rerender(
      <OrganizationProvider initialOrganizations={orgs}>
        <Probe />
      </OrganizationProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('org')).toHaveTextContent('org-one')
    })
  })

  it('resolves to the cookie-pointed org after initialOrganizations populates (effect-path fallback)', async () => {
    mockGetCookie.mockImplementation((name: string) =>
      name === 'organization-slug' ? 'org-two' : false,
    )

    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug ?? 'none'}</div>
    }

    const { rerender } = render(
      <OrganizationProvider initialOrganizations={[]}>
        <Probe />
      </OrganizationProvider>,
    )

    rerender(
      <OrganizationProvider initialOrganizations={orgs}>
        <Probe />
      </OrganizationProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('org')).toHaveTextContent('org-two')
    })
  })

  it('rewrites the cookie when initialSlug points to an org not in the list (stale-cookie fallback)', async () => {
    mockGetCookie.mockImplementation((name: string) =>
      name === 'organization-slug' ? 'stale-org' : false,
    )

    const Probe = () => {
      const org = useOrganization()
      return <div data-testid="org">{org?.slug ?? 'none'}</div>
    }

    render(
      <OrganizationProvider initialOrganizations={orgs} initialSlug="stale-org">
        <Probe />
      </OrganizationProvider>,
    )

    expect(screen.getByTestId('org')).toHaveTextContent('org-one')

    await waitFor(() => {
      expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'org-one')
    })
  })

  it('throws when useOrganization is used outside the provider', () => {
    const Probe = () => {
      useOrganization()
      return null
    }

    expect(() => render(<Probe />)).toThrow(
      'useOrganization must be used within OrganizationProvider',
    )
  })
})

// Default: ineligible, so existing picker tests render no "run for" actions.
const ineligible: Eligibility = {
  hasActiveCampaign: true,
  holdsOffice: false,
  canStartCampaign: false,
  canGainOffice: true,
  reelectionOfficeSlug: null,
}

const renderPicker = (
  initialOrganizations: Organization[] = orgs,
  eligibility: Eligibility = ineligible,
) => {
  api.mock('GET /v1/eligibility', { status: 200, data: eligibility })
  return render(
    <SidebarProvider>
      <OrganizationProvider initialOrganizations={initialOrganizations}>
        <OrganizationPicker />
      </OrganizationProvider>
    </SidebarProvider>,
  )
}

describe('OrganizationPicker', () => {
  it('renders nothing when there are no organizations', () => {
    renderPicker([])
    expect(screen.queryByText('GoodParty.org')).not.toBeInTheDocument()
  })

  it('displays the selected organization name', () => {
    renderPicker()
    expect(screen.getByText('Organization One')).toBeInTheDocument()
  })

  it('shows all organizations in the dropdown', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))

    const allOrgOneElements = screen.getAllByText('Organization One')
    expect(allOrgOneElements.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Organization Two')).toBeInTheDocument()
    expect(screen.getByText('Organization Three')).toBeInTheDocument()
  })

  it('sets the cookie when switching orgs', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))
    await user.click(screen.getByText('Organization Two'))

    await waitFor(() => {
      expect(mockSetCookie).toHaveBeenCalledWith('organization-slug', 'org-two')
    })
  })

  it('routes to /dashboard/chief-of-staff when switching to an elected office org', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))
    await user.click(screen.getByText('Organization Two'))

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/chief-of-staff')
    })
  })

  it('routes to /dashboard when switching to a non-elected-office org', async () => {
    const user = userEvent.setup()
    mockGetCookie.mockImplementation((name: string) =>
      name === 'organization-slug' ? 'org-two' : false,
    )
    renderPicker()

    await user.click(screen.getByText('Organization Two'))
    await user.click(screen.getByText('Organization One'))

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/dashboard')
    })
    expect(mockRouterPush).not.toHaveBeenCalledWith('/dashboard/briefings')
  })

  it('fetches organizations from the API', async () => {
    const updatedOrgs: Organization[] = [
      {
        slug: 'fetched',
        name: 'Fetched Org',
        positionName: null,
        position: null,
        district: null,
        electedOfficeId: null,
        campaignId: 10,
        status: 'active',
      },
    ]

    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: updatedOrgs },
    })

    testQueryClient.setDefaultOptions({
      queries: { staleTime: 0, retry: false },
    })

    renderPicker()

    await waitFor(() => {
      expect(screen.getByText('Fetched Org')).toBeInTheDocument()
    })

    testQueryClient.setDefaultOptions({
      queries: { staleTime: 1000 * 60 * 5, retry: 2 },
    })
  })

  it('renders past organizations grayed with a "Past" label', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))

    // Organization Three is the only `status: 'past'` org in the fixture.
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByText('Organization Three')).toHaveClass(
      'text-muted-foreground',
    )
    expect(screen.getAllByText('Organization One')[1]).not.toHaveClass(
      'text-muted-foreground',
    )
  })

  it('shows both run-for actions when eligible with a re-election office', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: 'eo-1',
    })

    await user.click(screen.getByText('Organization One'))

    expect(await screen.findByText('Run for re-election')).toBeInTheDocument()
    expect(screen.getByText('Run for a new office')).toBeInTheDocument()
  })

  it('hides both run-for actions when not eligible to start a campaign', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, { ...ineligible, reelectionOfficeSlug: 'eo-1' })

    await user.click(screen.getByText('Organization One'))

    // Wait for the dropdown to be open (org list visible) before asserting absence.
    expect(screen.getByText('Organization Two')).toBeInTheDocument()
    expect(screen.queryByText('Run for re-election')).not.toBeInTheDocument()
    expect(screen.queryByText('Run for a new office')).not.toBeInTheDocument()
  })

  it('shows only "Run for a new office" when there is no re-election office', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: null,
    })

    await user.click(screen.getByText('Organization One'))

    expect(await screen.findByText('Run for a new office')).toBeInTheDocument()
    expect(screen.queryByText('Run for re-election')).not.toBeInTheDocument()
  })

  it('navigates to the follow-on entry with the same-office intent on re-election', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: 'eo-held',
    })

    await user.click(screen.getByText('Organization One'))
    await user.click(await screen.findByText('Run for re-election'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/onboarding/office-selection?intent=same-office&from=eo-held',
    )
  })

  it('navigates to the follow-on entry with the new-office intent', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: null,
    })

    await user.click(screen.getByText('Organization One'))
    await user.click(await screen.findByText('Run for a new office'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/onboarding/office-selection?intent=new-office',
    )
  })

  it('tracks an organization switch with the target status and office flag', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))
    // Organization Three is past and not an elected-office org.
    await user.click(screen.getByText('Organization Three'))

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.OrgSwitcher.OrganizationSwitched,
        { toStatus: 'past', isElectedOfficeOrg: false },
      )
    })
  })

  it('does not track a switch when re-selecting the already-active org', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Organization One'))
    // Re-click the currently selected org (org-one) in the open dropdown
    // (index 0 is the trigger label, index 1 is the dropdown item).
    const dropdownItem = screen.getAllByText('Organization One').at(1)
    if (!dropdownItem) throw new Error('expected org-one dropdown item')
    await user.click(dropdownItem)

    // No analytics event should fire at all on a same-org re-click.
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('tracks the run-for CTA with intent and source office on re-election', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: 'eo-held',
    })

    await user.click(screen.getByText('Organization One'))
    await user.click(await screen.findByText('Run for re-election'))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.OrgSwitcher.RunForOfficeClicked,
      { intent: 'same-office', fromOrganizationSlug: 'eo-held' },
    )
  })

  it('tracks the run-for CTA with no source office on a new-office run', async () => {
    const user = userEvent.setup()
    renderPicker(orgs, {
      ...ineligible,
      hasActiveCampaign: false,
      canStartCampaign: true,
      reelectionOfficeSlug: null,
    })

    await user.click(screen.getByText('Organization One'))
    await user.click(await screen.findByText('Run for a new office'))

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.OrgSwitcher.RunForOfficeClicked,
      { intent: 'new-office' },
    )
  })
})

describe('X-Organization-Slug header attachment', () => {
  it('gpFetch attaches the header when the org cookie is set', async () => {
    mockGetCookie.mockImplementation((name: string) =>
      name === 'organization-slug' ? 'org-one' : false,
    )

    let capturedHeader: string | undefined
    api.mock('GET /v1/organizations', ({ headers }) => {
      capturedHeader = headers['x-organization-slug']
      return {
        status: 200,
        data: { organizations: orgs },
      }
    })

    const gpFetch = (await import('gpApi/gpFetch')).default
    await gpFetch({ url: '/api/v1/organizations', method: 'GET' })

    expect(capturedHeader).toBe('org-one')
  })

  it('gpFetch does not attach the header when no org cookie exists', async () => {
    mockGetCookie.mockReturnValue(false)

    let capturedHeader: string | undefined
    api.mock('GET /v1/organizations', ({ headers }) => {
      capturedHeader = headers['x-organization-slug']
      return {
        status: 200,
        data: { organizations: orgs },
      }
    })

    const gpFetch = (await import('gpApi/gpFetch')).default
    await gpFetch({ url: '/api/v1/organizations', method: 'GET' })

    expect(capturedHeader).toBeUndefined()
  })

  it('handleApiRequestRewrite attaches the header from cookies', async () => {
    const { handleApiRequestRewrite } =
      await import('helpers/handleApiRequestRewrite')

    const reqUrl = new URL('http://localhost:4000/api/v1/organizations')
    const request = new Request(reqUrl.toString())

    const headersSpy = vi.spyOn(request.headers, 'set')

    Object.defineProperty(request, 'cookies', {
      value: {
        get: (name: string) => {
          if (name === 'organization-slug') return { value: 'org-two' }
          return undefined
        },
      },
    })

    Object.defineProperty(request, 'nextUrl', {
      value: reqUrl,
    })

    await handleApiRequestRewrite(request as any, null)

    expect(headersSpy).toHaveBeenCalledWith('X-Organization-Slug', 'org-two')
  })

  it('handleApiRequestRewrite does not attach header when no org cookie exists', async () => {
    const { handleApiRequestRewrite } =
      await import('helpers/handleApiRequestRewrite')

    const reqUrl = new URL('http://localhost:4000/api/v1/organizations')
    const request = new Request(reqUrl.toString())

    const headersSpy = vi.spyOn(request.headers, 'set')

    Object.defineProperty(request, 'cookies', {
      value: {
        get: () => undefined,
      },
    })

    Object.defineProperty(request, 'nextUrl', {
      value: reqUrl,
    })

    await handleApiRequestRewrite(request as any, null)

    expect(headersSpy).not.toHaveBeenCalledWith(
      'X-Organization-Slug',
      expect.anything(),
    )
  })
})
