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

const renderProvider = (children: React.ReactNode) =>
  render(
    <SidebarProvider>
      <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
        {children}
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
  // ENG-11670: the chat dock is not mounted while FollowOnFlow switches orgs
  // (it lives in the dashboard layout, the flow is an onboarding route). An
  // invalidate marks an inactive entry stale but KEEPS its data, so the dock
  // mounted on the new org read the previous org's conversation list
  // synchronously and tried to resume a conversation it does not own. A key
  // with no org slug in it has nothing else to save it.
  it('does not let an unmounted consumer read the previous org\u2019s data', async () => {
    const fetcher = vi.fn(async () => [{ conversationId: `c-${orgCookie}` }])
    const historyKey = ['campaign-manager', 'chat-history']

    const ChatDock = () => {
      const { data } = useQuery({ queryKey: historyKey, queryFn: fetcher })
      return (
        <div data-testid="dock">{data?.[0]?.conversationId ?? 'pending'}</div>
      )
    }

    const ToggleDock = ({ mounted }: { mounted: boolean }) =>
      mounted ? <ChatDock /> : null

    const Harness = () => {
      const [dockMounted, setDockMounted] = useState(true)
      return (
        <OrganizationProvider initialOrganizations={orgs} initialSlug="org-one">
          <button type="button" onClick={() => setDockMounted(false)}>
            close dock
          </button>
          <button type="button" onClick={() => setDockMounted(true)}>
            open dock
          </button>
          <ToggleDock mounted={dockMounted} />
          <OrganizationPicker />
        </OrganizationProvider>
      )
    }

    render(
      <SidebarProvider>
        <Harness />
      </SidebarProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('dock')).toHaveTextContent('c-org-one'),
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'close dock' }))
    expect(screen.queryByTestId('dock')).not.toBeInTheDocument()

    // The switch happens with no observer of the history query mounted — the
    // FollowOnFlow shape (the dock lives in the dashboard layout, the flow is
    // an onboarding route).
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

  // The campaign query is seeded from the server's initialData, so removing its
  // entry is not enough: the still-mounted provider rebuilds it from that seed
  // and it counts as fresh. Without the invalidate that follows, the campaign
  // context kept answering for the org we just left.
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

  // ENG-10991: a row owned by the org being left can be actively observed at
  // the moment of the switch, and its key carries no org slug either. The read
  // must not follow the row to the new org's header and 404. removeQueries
  // deletes the entry and issues no fetch; the observer that stays mounted only
  // rebuilds an EMPTY entry, so nothing re-requests it.
  it('never re-requests a per-row detail that belonged to the org being left', async () => {
    const detailFetcher = vi.fn(async () => ({
      id: 999,
      forOrg: orgCookie,
    }))

    // The probe re-renders after the switch, the way the real consumers do:
    // `setSelectedSlug` calls `refreshFlags()`, which re-renders the flagged
    // page subtree, and the campaign refetch re-renders anything reading it.
    // A refreshed observer is what would rebuild the entry and fetch it under
    // the new header, so a probe that never re-renders would not prove this.
    let rerenderRow: () => void = () => undefined
    const RowProbe = () => {
      const [renders, setRenders] = useState(0)
      rerenderRow = () => setRenders((count) => count + 1)
      useQuery({
        queryKey: ['outreach-detail', 999],
        queryFn: detailFetcher,
      })
      return <span data-testid="row-renders">{renders}</span>
    }

    renderProvider(<RowProbe />)

    await waitFor(() => expect(detailFetcher).toHaveBeenCalledTimes(1))

    await switchToOrgTwo()

    const rendersBefore = screen.getByTestId('row-renders').textContent
    await act(async () => rerenderRow())
    await settle()
    expect(screen.getByTestId('row-renders').textContent).not.toBe(
      rendersBefore,
    )

    expect(detailFetcher).toHaveBeenCalledTimes(1)
  })

  // contact-notes is the same shape as outreach-detail — per person id, read by
  // a panel that can stay open across the switch — so it takes the same care.
  it('never re-requests a contact-notes row that belonged to the org being left', async () => {
    const notesFetcher = vi.fn().mockResolvedValue([{ id: 'note-1' }])

    let rerenderNotes: () => void = () => undefined
    const NotesProbe = () => {
      const [renders, setRenders] = useState(0)
      rerenderNotes = () => setRenders((count) => count + 1)
      useQuery({ queryKey: ['contact-notes', 42], queryFn: notesFetcher })
      return <span data-testid="notes-renders">{renders}</span>
    }

    renderProvider(<NotesProbe />)

    await waitFor(() => expect(notesFetcher).toHaveBeenCalledTimes(1))

    await switchToOrgTwo()

    const rendersBefore = screen.getByTestId('notes-renders').textContent
    await act(async () => rerenderNotes())
    await settle()
    expect(screen.getByTestId('notes-renders').textContent).not.toBe(
      rendersBefore,
    )

    expect(notesFetcher).toHaveBeenCalledTimes(1)
  })

  it('leaves only the org-scoped keys and the per-row guard in the cache', async () => {
    const guardedFetcher = vi.fn().mockResolvedValue({ id: 999 })
    const GuardedProbe = () => {
      useQuery({
        queryKey: ['outreach-detail', 999],
        queryFn: guardedFetcher,
      })
      return null
    }

    renderProvider(<GuardedProbe />)
    await waitFor(() =>
      expect(
        testQueryClient.getQueryData(['outreach-detail', 999]),
      ).toBeDefined(),
    )

    await switchToOrgTwo()

    // Only the org-scoped survivors and the per-row guard are left; no
    // org-agnostic leftover rides along with them.
    expect(
      testQueryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey[0])
        .sort(),
    ).toEqual(['eligibility', 'organizations', 'outreach-detail'])
    expect(screen.getByText('Organization Two')).toBeInTheDocument()
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
