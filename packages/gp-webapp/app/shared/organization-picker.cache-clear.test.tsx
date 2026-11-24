import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { Eligibility, Organization } from 'gpApi/api-endpoints'
import { SidebarProvider } from '@styleguide'
import { CampaignProvider } from './hooks/CampaignProvider'
import { useCampaign } from './hooks/useCampaign'
import {
  ORGANIZATIONS_QUERY_KEY,
  OrganizationProvider,
  OrganizationPicker,
  OrganizationScope,
  useOrganization,
  useSetOrganizationSlug,
} from './organization-picker'

vi.mock('@styleguide/hooks/use-mobile', () => ({ useIsMobile: () => false }))

vi.mock('app/dashboard/shared/plan/useBadgePlan', () => ({
  useBadgePlan: () => 'free',
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// The X-Organization-Slug header comes off this cookie, so a writable mock is
// what lets a fetcher record which org it actually answered for.
let orgCookie: string | false = 'org-one'
vi.mock('helpers/cookieHelper', () => ({
  getCookie: (name: string) =>
    name === 'organization-slug' ? orgCookie : false,
  setCookie: (name: string, value: string) => {
    if (name === 'organization-slug') orgCookie = value
  },
  deleteCookie: vi.fn(),
}))

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
    electedOfficeId: null,
    campaignId: 2,
    status: 'active',
  },
]

const ineligible: Eligibility = {
  hasActiveCampaign: true,
  holdsOffice: false,
  canStartCampaign: false,
  canGainOffice: true,
  reelectionOfficeSlug: null,
}

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
}

beforeEach(() => {
  orgCookie = 'org-one'
  testQueryClient.clear()
  api.mock('GET /v1/eligibility', { status: 200, data: ineligible })
})

// Mirrors the real shells (DashboardLayout, VolunteerSidebar): the picker is
// rendered inside the provider but outside OrganizationScope, so the switch it
// triggers never unmounts it.
const renderProvider = (children: React.ReactNode) =>
  render(
    <SidebarProvider>
      <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
        <OrganizationScope>{children}</OrganizationScope>
        <OrganizationPicker />
      </OrganizationProvider>
    </SidebarProvider>,
  )

const switchToOrgTwo = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Organization One/ }))
  await user.click(screen.getByText('Organization Two'))
  await waitFor(() => expect(orgCookie).toBe('org-two'))
  await settle()
}

describe('org switch clears the query cache', () => {
  // ENG-11670: an org-agnostic key has nothing to save it — a consumer that
  // mounts on the new org must not find the previous org's conversation list
  // waiting in the cache, because it reads it synchronously and tries to
  // resume a conversation it does not own.
  it('does not leave an unmounted consumer the previous org\u2019s data to read', async () => {
    const fetcher = vi.fn(async () => [{ conversationId: `c-${orgCookie}` }])
    const historyKey = ['campaign-manager', 'chat-history']

    const ChatDock = () => {
      const { data } = useQuery({ queryKey: historyKey, queryFn: fetcher })
      return (
        <div data-testid="dock">{data?.[0]?.conversationId ?? 'pending'}</div>
      )
    }

    // The dock fills the key, then unmounts, so an org-one entry with no
    // observer is sitting in the cache at switch time — the FollowOnFlow shape
    // (the dock lives in the dashboard layout, the flow is an onboarding
    // route). The toggle lives above OrganizationScope so the remount cannot
    // reset it and re-open the dock by itself.
    const Harness = () => {
      const [dockMounted, setDockMounted] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setDockMounted(false)}>
            close dock
          </button>
          <button type="button" onClick={() => setDockMounted(true)}>
            open dock
          </button>
          {dockMounted && <ChatDock />}
        </>
      )
    }

    render(
      <SidebarProvider>
        <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
          <Harness />
          <OrganizationScope>
            <div />
          </OrganizationScope>
          <OrganizationPicker />
        </OrganizationProvider>
      </SidebarProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('dock')).toHaveTextContent('c-org-one'),
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'close dock' }))
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument()
    expect(testQueryClient.getQueryData(historyKey)).toBeDefined()

    await switchToOrgTwo()

    // An invalidate would leave the previous org's list here, readable by the
    // dock the moment it mounts; clearing removes it.
    expect(testQueryClient.getQueryData(historyKey)).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'open dock' }))

    expect(screen.getByTestId('dock')).not.toHaveTextContent('c-org-one')
    await waitFor(() =>
      expect(screen.getByTestId('dock')).toHaveTextContent('c-org-two'),
    )
  })

  // The mounted-observer counterpart: with a reader on screen the whole time,
  // the switch must land on the new org's data, not linger on the old one's.
  it('refetches a mounted org-agnostic query for the new org', async () => {
    const fetcher = vi.fn(async () => [{ conversationId: `c-${orgCookie}` }])

    const ChatDock = () => {
      const organization = useOrganization()
      const { data } = useQuery({
        queryKey: ['campaign-manager', 'chat-history'],
        queryFn: fetcher,
      })
      return (
        <div data-testid="dock">
          {organization?.slug}|{data?.[0]?.conversationId}
        </div>
      )
    }

    renderProvider(<ChatDock />)
    await waitFor(() =>
      expect(screen.getByTestId('dock')).toHaveTextContent('org-one|c-org-one'),
    )

    await switchToOrgTwo()

    await waitFor(() =>
      expect(screen.getByTestId('dock')).toHaveTextContent('org-two|c-org-two'),
    )
  })

  // The campaign query is seeded from the server's initialData and sits above
  // OrganizationScope (CampaignProvider wraps the dashboard shell), so the
  // remount does not reset it. Removing its entry is not enough either: it is
  // rebuilt from that seed and counts as fresh. Without the invalidate that
  // follows the clear, the campaign context kept answering for the org we just
  // left for its whole five-minute stale time.
  it('refetches the initialData-seeded campaign context for the new org', async () => {
    const requestedFor: string[] = []
    api.mock('GET /v1/campaigns/mine', () => {
      requestedFor.push(String(orgCookie))
      return {
        status: 200 as const,
        data: { slug: `c-${orgCookie}` } as never,
      }
    })

    const CampaignProbe = () => {
      const [campaign] = useCampaign()
      return <div data-testid="campaign">{campaign?.slug ?? 'null'}</div>
    }

    render(
      <SidebarProvider>
        <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
          <CampaignProvider campaign={{ slug: 'c-org-one' } as never}>
            <CampaignProbe />
            <OrganizationPicker />
          </CampaignProvider>
        </OrganizationProvider>
      </SidebarProvider>,
    )

    await settle()
    expect(screen.getByTestId('campaign')).toHaveTextContent('c-org-one')

    await switchToOrgTwo()

    await waitFor(() =>
      expect(screen.getByTestId('campaign')).toHaveTextContent('c-org-two'),
    )
    expect(requestedFor).toEqual(['org-two'])
  })

  // ENG-10991: a row owned by the org being left can be on screen at the moment
  // of the switch, and its key carries no org slug. What saves it is the
  // remount: the page that held the departed rows is discarded, so no observer
  // survives to rebuild the entry and re-request the row under the incoming
  // org's header (which 404s).
  it('never re-requests a per-row detail that belonged to the org being left', async () => {
    const detailFetcher = vi.fn(async () => ({ id: 999, forOrg: orgCookie }))
    // The rows themselves come from the org's read and live in page state,
    // which is exactly what the remount discards.
    const rowsFetcher = vi.fn(async () =>
      orgCookie === 'org-one' ? [999] : [],
    )

    const RowDetail = ({ rowId }: { rowId: number }) => {
      useQuery({
        queryKey: ['outreach-detail', rowId],
        queryFn: detailFetcher,
      })
      return <span data-testid="detail">{rowId}</span>
    }

    const RowsPage = () => {
      const { data: rows } = useQuery({
        queryKey: ['org-rows'],
        queryFn: rowsFetcher,
      })
      return (
        <div data-testid="rows">
          {(rows ?? []).map((rowId) => (
            <RowDetail key={rowId} rowId={rowId} />
          ))}
        </div>
      )
    }

    renderProvider(<RowsPage />)

    await waitFor(() => expect(detailFetcher).toHaveBeenCalledTimes(1))

    await switchToOrgTwo()

    await waitFor(() =>
      expect(screen.getByTestId('rows')).not.toHaveTextContent('999'),
    )
    expect(detailFetcher).toHaveBeenCalledTimes(1)
    expect(
      testQueryClient.getQueryData(['outreach-detail', 999]),
    ).toBeUndefined()
  })

  // contact-notes is the same shape as outreach-detail — per person id, read by
  // a panel that can stay open across the switch — so the remount covers it too:
  // the person id comes from org-scoped state, which the remount discards.
  it('never re-requests a contact-notes row that belonged to the org being left', async () => {
    const notesFetcher = vi.fn(async () => [{ id: `note-${orgCookie}` }])

    const PersonNotes = ({ personId }: { personId: number }) => {
      useQuery({
        queryKey: ['contact-notes', personId],
        queryFn: notesFetcher,
      })
      return <span data-testid="person">{personId}</span>
    }

    const PersonPanel = () => {
      const { data: personIds } = useQuery({
        queryKey: ['org-people'],
        queryFn: async () => (orgCookie === 'org-one' ? [42] : []),
      })
      return (
        <div data-testid="people">
          {(personIds ?? []).map((personId) => (
            <PersonNotes key={personId} personId={personId} />
          ))}
        </div>
      )
    }

    renderProvider(<PersonPanel />)

    await waitFor(() => expect(notesFetcher).toHaveBeenCalledTimes(1))

    await switchToOrgTwo()

    await waitFor(() =>
      expect(screen.getByTestId('people')).not.toHaveTextContent('42'),
    )
    expect(notesFetcher).toHaveBeenCalledTimes(1)
    expect(testQueryClient.getQueryData(['contact-notes', 42])).toBeUndefined()
  })

  // FollowOnFlow, ElectionResultPage and Test mode all create an org and then
  // refresh the org list BEFORE selecting it, because the list is what makes
  // the new slug resolvable. Clearing that list would drop the refreshed data
  // and fall back to initialOrganizations[0].
  it('keeps a slug the caller just refreshed into the list resolvable', async () => {
    const newOrg: Organization = {
      slug: 'campaign-99',
      name: 'New Campaign',
      positionName: null,
      position: null,
      district: null,
      electedOfficeId: null,
      campaignId: 99,
      status: 'active',
    }
    const campaignReads: (string | undefined)[] = []
    api.mock('GET /v1/campaigns/mine', () => {
      campaignReads.push(String(orgCookie))
      return { status: 200 as const, data: { slug: 'c' } as never }
    })

    const SelectedOrg = () => {
      const organization = useOrganization()
      return <div data-testid="selected">{organization?.slug ?? 'none'}</div>
    }
    const CreateAndSelect = () => {
      const queryClient = useQueryClient()
      const setSlug = useSetOrganizationSlug()
      return (
        <button
          type="button"
          onClick={() => {
            queryClient.setQueryData(ORGANIZATIONS_QUERY_KEY, [...orgs, newOrg])
            setSlug(newOrg.slug)
          }}
        >
          create
        </button>
      )
    }

    render(
      <SidebarProvider>
        <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
          <CampaignProvider campaign={{ slug: 'c' } as never}>
            <SelectedOrg />
            <CreateAndSelect />
          </CampaignProvider>
        </OrganizationProvider>
      </SidebarProvider>,
    )

    await settle()
    expect(screen.getByTestId('selected')).toHaveTextContent('org-one')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'create' }))
    await settle()

    // The newly created org is the selected one, not a fallback to the first
    // org of the stale server seed (which would also repair the cookie onto
    // that fallback and refetch everything under the wrong header).
    expect(screen.getByTestId('selected')).toHaveTextContent(newOrg.slug)
    expect(orgCookie).toBe(newOrg.slug)
  })

  // The old predicate kept the org list because invalidating it flashed the
  // nav empty while it refetched. It is cleared now, so the switcher must not
  // blank out in the window before the provider's own re-read lands.
  it('never renders the switcher empty while the org list is re-read', async () => {
    let releaseReRead: () => void = () => undefined
    api.mock('GET /v1/organizations', async () => {
      await new Promise<void>((resolve) => {
        releaseReRead = resolve
      })
      return { status: 200, data: { organizations: orgs } }
    })

    renderProvider(<div />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Organization One/ }))
    await user.click(screen.getByText('Organization Two'))
    await waitFor(() => expect(orgCookie).toBe('org-two'))

    // Mid-flight: the re-read is deliberately held open. The trigger and the
    // destination org must already be rendered.
    expect(screen.getByText('Organization Two')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Organization Two/ }),
    ).toBeInTheDocument()

    releaseReRead()
    await settle()
    expect(screen.getByText('Organization Two')).toBeInTheDocument()
  })
})
