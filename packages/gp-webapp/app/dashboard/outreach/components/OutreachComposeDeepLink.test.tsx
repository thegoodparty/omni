import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachComposeDeepLink } from './OutreachComposeDeepLink'
import type { Campaign } from 'helpers/types'

let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => '/dashboard/outreach',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// The hub owns the flow mounts, so this component's whole output is the
// request it hands over — that callback is the contract under test.
const onCompose = vi.fn()

const renderDeepLink = ({
  isPro,
  resumesDraft,
}: {
  isPro: boolean
  resumesDraft?: (type: string) => boolean
}) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro } as Campaign]}>
      <OutreachComposeDeepLink
        onCompose={onCompose}
        resumesDraft={resumesDraft}
      />
    </CampaignContext.Provider>,
  )

const composeRequest = () => onCompose.mock.calls[0]?.[0]

describe('OutreachComposeDeepLink', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    mockPush.mockClear()
    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  it('asks for the text flow with the decoded preset and consumes the params', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: true })

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

  // An arrival on a channel the campaign already holds a draft for resumes
  // that row instead of creating a campaign, so the create event has to say
  // so rather than counting it as a create.
  it('marks the create event as a resume when the hub will resume a draft', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderDeepLink({
      isPro: true,
      resumesDraft: (type) => type === 'text',
    })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'deep_link',
      resumed: true,
    })
  })

  it('asks for the flow with no script when message is missing', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderDeepLink({ isPro: true })

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
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().script).toHaveLength(P2P_SCRIPT_MAX_LENGTH)
  })

  it('passes a valid due param through as the campaign-plan due date', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=2026-08-03')
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().due).toBe('2026-08-03')
  })

  it('ignores a malformed due param', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=next-tuesday')
    renderDeepLink({ isPro: true })

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
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'campaign_tracker',
    })

    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
    mockSearchParams = new URLSearchParams('compose=text&source=whatever')
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'deep_link',
    })
  })

  it('asks for the robocall flow with the due date for a Pro user', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall&due=2026-08-03')
    renderDeepLink({ isPro: true })

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

  // The voter data page's channel picker opens every flow through this
  // link, so phone banking and social ride the same param as text/robocall.
  it('asks for the phone-banking flow for a Pro user, carrying the source', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=phoneBanking&source=voter_data&listId=42',
    )
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'phoneBanking', listId: 42 })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'phoneBanking',
      source: 'voter_data',
    })
  })

  it('asks for the social flow with no gate', async () => {
    mockSearchParams = new URLSearchParams('compose=social&source=voter_data')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'socialMedia' })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('carries a recommended variant alongside compose', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&recommended=persuadeAffinity',
    )
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({
      type: 'text',
      recommendedVariant: 'persuadeAffinity',
    })
    expect(composeRequest().listId).toBeUndefined()
  })

  it('drops an unknown recommended variant rather than carrying it', async () => {
    mockSearchParams = new URLSearchParams('compose=text&recommended=nope')
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().recommendedVariant).toBeUndefined()
  })

  // ENG-10762: the CRM "Send outreach" link carries ?listId=<id> so the
  // server can read it and thread it to the audience step — nothing left
  // for it to do client-side, so it's stripped from the address bar the
  // same way `compose` is.
  it('strips a bare listId param from the address bar on mount', async () => {
    mockSearchParams = new URLSearchParams('listId=123')
    renderDeepLink({ isPro: true })

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
        scroll: false,
      }),
    )
    expect(onCompose).not.toHaveBeenCalled()
  })

  // The voter data page's recommended cards carry ?recommended=<variant>
  // the same way; the server reads it, so it is stripped the same way.
  it('strips a bare recommended param from the address bar on mount', async () => {
    mockSearchParams = new URLSearchParams('recommended=persuadeAffinity')
    renderDeepLink({ isPro: true })

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
    })

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))

    mockSearchParams = new URLSearchParams()
    view.rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <OutreachComposeDeepLink onCompose={onCompose} />
      </CampaignContext.Provider>,
    )
    expect(mockReplace).toHaveBeenCalledTimes(1)

    mockSearchParams = new URLSearchParams('listId=456')
    view.rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <OutreachComposeDeepLink onCompose={onCompose} />
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
    renderDeepLink({ isPro: true })

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
    renderDeepLink({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().listId).toBeUndefined()
  })

  it('does nothing without a compose param', async () => {
    renderDeepLink({ isPro: true })

    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled()
    })
    expect(onCompose).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})

// A Campaign Manager compose_handoff: the nonce rides `?handoff=` instead of
// the URL (which would expose the draft text), resolved against the
// sessionStorage entry ChiefOfStaffChatBody wrote.
describe('OutreachComposeDeepLink — Campaign Manager handoff', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    mockPush.mockClear()
    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('resolves a win_social nonce into socialPrefill and consumes it once', async () => {
    sessionStorage.setItem(
      'cos-handoff-n1',
      JSON.stringify({
        channel: 'win_social',
        draftText: 'The bridge reopens Monday.',
        purpose: 'event_invite',
      }),
    )
    mockSearchParams = new URLSearchParams('compose=social&handoff=n1')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({
      type: 'socialMedia',
      socialPrefill: {
        draftText: 'The bridge reopens Monday.',
        purpose: 'event_invite',
      },
    })
    expect(sessionStorage.getItem('cos-handoff-n1')).toBeNull()
  })

  it('ignores a serve_social payload under the nonce', async () => {
    sessionStorage.setItem(
      'cos-handoff-n1',
      JSON.stringify({ channel: 'serve_social', draftText: 'x' }),
    )
    mockSearchParams = new URLSearchParams('compose=social&handoff=n1')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().socialPrefill).toBeUndefined()
  })

  it('opens a blank flow with no prefill and no throw when the nonce is missing', async () => {
    mockSearchParams = new URLSearchParams('compose=social&handoff=expired')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().socialPrefill).toBeUndefined()
  })

  it('opens a blank flow with no prefill and no throw on a malformed stored payload', async () => {
    sessionStorage.setItem('cos-handoff-n1', 'not-json')
    mockSearchParams = new URLSearchParams('compose=social&handoff=n1')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest().socialPrefill).toBeUndefined()
  })
})

// Milestone 2: the deep link stops being the gate for the three channels
// whose flows now carry one — it opens them and they pause themselves.
describe('OutreachComposeDeepLink — the flows own the gate', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    mockPush.mockClear()
    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  it('opens the text flow for a free, unregistered campaign', async () => {
    mockSearchParams = new URLSearchParams('compose=text&message=Hi')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'text', script: 'Hi' })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('opens the robocall flow for a free campaign instead of the Pro modal', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'robocall' })
    expect(
      screen.queryByText('Get Pro voter data and tools'),
    ).not.toBeInTheDocument()
  })

  it('opens the phone-banking flow for a free campaign instead of the wizard', async () => {
    mockSearchParams = new URLSearchParams('compose=phoneBanking')
    renderDeepLink({ isPro: false })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'phoneBanking' })
    expect(mockPush).not.toHaveBeenCalled()
  })
})

// Every link that opens a new text passes through here, so this is the one
// place a closed texting window has to stop them.
describe('OutreachComposeDeepLink — texting closed for this race', () => {
  const CUTOFF_TITLE =
    'The Oct. 15 deadline to get verified for texting has passed.'
  const renderClosed = ({ isPro }: { isPro: boolean }) =>
    render(
      <CampaignContext.Provider
        value={[
          {
            id: 1,
            isPro,
            smsCompliance: 'closed',
            smsCutoffDate: '2026-10-15',
            generalElectionDate: '2026-11-03',
          } as Campaign,
        ]}
      >
        <OutreachComposeDeepLink onCompose={onCompose} />
      </CampaignContext.Provider>,
    )

  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    mockPush.mockClear()
    onCompose.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  it('shows the cutoff notice for ?compose=text', async () => {
    mockSearchParams = new URLSearchParams('compose=text&message=Hi')
    renderClosed({ isPro: true })

    expect(
      await screen.findByRole('dialog', { name: CUTOFF_TITLE }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'You can still reach voters with door knocking, robocalls, phone banking and social media.',
      ),
    ).toBeInTheDocument()
    expect(onCompose).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.Outreach.ClickCreate,
      expect.anything(),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.SmsCutoff.NoticeViewed,
      {
        surface: 'compose_deep_link',
        cutoffDate: '2026-10-15',
        generalElectionDate: '2026-11-03',
      },
    )
  })

  it('shows the notice to a free candidate instead of the Pro wizard', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderClosed({ isPro: false })

    expect(
      await screen.findByRole('dialog', { name: CUTOFF_TITLE }),
    ).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(onCompose).not.toHaveBeenCalled()
  })

  it('closes the notice when the candidate picks another channel', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderClosed({ isPro: true })

    const robocalls = await screen.findByRole('link', { name: /Robocalls/ })
    expect(robocalls).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=robocall',
    )
    robocalls.click()

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.SmsCutoff.NoticeCompleted,
      { surface: 'compose_deep_link', channel: 'robocall' },
    )
  })

  it('still opens the other channels', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall')
    renderClosed({ isPro: true })

    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1))
    expect(composeRequest()).toMatchObject({ type: 'robocall' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
