import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachComposeDeepLink } from './OutreachComposeDeepLink'
import type { Campaign, TcrCompliance } from 'helpers/types'

let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/dashboard/outreach',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const approvedCompliance = { status: 'approved' } as TcrCompliance
const pendingCompliance = { status: 'pending' } as TcrCompliance

// The hub owns the flow mounts, so this component's whole output is the
// request it hands over — that callback is the contract under test.
const onCompose = vi.fn()

const renderDeepLink = ({
  isPro,
  tcrCompliance,
}: {
  isPro: boolean
  tcrCompliance?: TcrCompliance
}) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro } as Campaign]}>
      <OutreachComposeDeepLink
        tcrCompliance={tcrCompliance}
        onCompose={onCompose}
      />
    </CampaignContext.Provider>,
  )

const composeRequest = () => onCompose.mock.calls[0]?.[0]

describe('OutreachComposeDeepLink', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  it('asks for the text flow with the decoded preset and consumes the params', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({
      type: 'text',
      script: 'Hello voters',
    })
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'deep_link',
    })
  })

  it('asks for the flow with no script when message is missing', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().script).toBeUndefined()
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('clamps the message to the sms script limit', async () => {
    mockSearchParams = new URLSearchParams(
      `compose=text&message=${'a'.repeat(P2P_SCRIPT_MAX_LENGTH + 400)}`,
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().script).toHaveLength(P2P_SCRIPT_MAX_LENGTH)
  })

  it('passes a valid due param through as the campaign-plan due date', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=2026-08-03')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().due).toBe('2026-08-03')
  })

  it('ignores a malformed due param', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=next-tuesday')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().due).toBeUndefined()
  })

  // The linking surface rides in the URL so the hub can report where the
  // press happened; anything not on the allowlist reads as a plain deep link
  // rather than injecting an arbitrary source into analytics.
  it('reports an allowlisted source and rejects an arbitrary one', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&source=campaign_tracker',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'campaign_tracker',
    })

    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
    mockSearchParams = new URLSearchParams('compose=text&source=whatever')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'deep_link',
    })
  })

  it('asks for the robocall flow with the due date for a Pro user', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall&due=2026-08-03')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({
      type: 'robocall',
      due: '2026-08-03',
    })
    // Robocall's deliverable is a recording, so no script rides along even
    // when the URL carries one.
    expect(composeRequest().script).toBeUndefined()
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'robocall',
      source: 'deep_link',
    })
  })

  it('gates robocall behind Pro with the upgrade modal', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall')
    renderDeepLink({ isPro: false, tcrCompliance: approvedCompliance })

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
        scroll: false,
      }),
    )
    expect(onCompose).not.toHaveBeenCalled()
  })

  it('shows the P2P upgrade modal instead of asking for a flow for a non-Pro user', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: false, tcrCompliance: approvedCompliance })

    expect(
      await screen.findByText('Level the playing field for less'),
    ).toBeInTheDocument()
    expect(onCompose).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('shows the compliance modal instead of asking for a flow for a Pro non-compliant user', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: true, tcrCompliance: pendingCompliance })

    expect(
      await screen.findByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(onCompose).not.toHaveBeenCalled()
  })

  // ENG-10762: the CRM "Send outreach" link carries ?listId=<id> so the
  // server can read it and thread it to the audience step — nothing left
  // for it to do client-side, so it's stripped from the address bar the
  // same way `compose` is.
  it('strips a bare listId param from the address bar on mount', async () => {
    mockSearchParams = new URLSearchParams('listId=123')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
        scroll: false,
      }),
    )
    expect(onCompose).not.toHaveBeenCalled()
  })

  it('re-arms after the strip so a second listId navigation strips again', async () => {
    mockSearchParams = new URLSearchParams('listId=123')
    const view = renderDeepLink({
      isPro: true,
      tcrCompliance: approvedCompliance,
    })

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))

    mockSearchParams = new URLSearchParams()
    view.rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <OutreachComposeDeepLink
          tcrCompliance={approvedCompliance}
          onCompose={onCompose}
        />
      </CampaignContext.Provider>,
    )
    expect(mockReplace).toHaveBeenCalledTimes(1)

    mockSearchParams = new URLSearchParams('listId=456')
    view.rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <OutreachComposeDeepLink
          tcrCompliance={approvedCompliance}
          onCompose={onCompose}
        />
      </CampaignContext.Provider>,
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(2))
    expect(mockReplace).toHaveBeenLastCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('consumes both compose and listId together in a single replace, carrying the list', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters&listId=123',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    // This component resolves listId itself rather than relying on the
    // server-threaded prop the channel tiles read, because it hands the
    // whole request over in one go.
    expect(composeRequest()).toMatchObject({ type: 'text', listId: 123 })
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    // Only the compose effect's replace fires — the listId-only effect
    // defers to it rather than firing a second, redundant replace.
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed listId when combined with compose', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters&listId=not-a-number',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().listId).toBeUndefined()
  })

  it('does nothing without a compose param', async () => {
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled()
    })
    expect(onCompose).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
