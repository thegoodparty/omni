import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { voterPackQueryOptions } from 'app/dashboard/door-knocking/native/useVoterPack'
import type { RecommendedListVariant } from '@goodparty_org/contracts'
import { trackEvent } from 'helpers/analyticsHelper'
import { ChannelTileGrid } from './ChannelTileGrid'
import type { AudiencePreselect } from './audiencePreselect'

// Counts district downloads. The real one is a binary fetch of tens of MB, and
// what this file cares about is only whether pressing the tile asks for it.
const packFetches = vi.hoisted(() => ({ count: 0 }))
vi.mock('app/dashboard/door-knocking/native/useVoterPack', () => ({
  voterPackQueryOptions: {
    queryKey: ['door-knocking-pack'],
    queryFn: async () => {
      packFetches.count += 1
      return {}
    },
  },
}))

const mockRouterPush = vi.fn()
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const runTextGate = vi.hoisted(() => vi.fn(() => true))
vi.mock('app/dashboard/outreach/hooks/useTextOutreachGate', () => ({
  useTextOutreachGate: () => ({ runTextGate, gateModals: null }),
}))

// Milestone 2's gate flag. Off by default, so every case in this file keeps
// asserting today's upgrade-at-entry behavior.
const proGatingV2 = { ready: true, enabled: false }
vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: () => proGatingV2,
}))

let mockCampaign: {
  id: number
  isPro: boolean
  smsCompliance?: string
  smsCutoffDate?: string
  generalElectionDate?: string
} = { id: 9, isPro: true }
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign, vi.fn()],
}))

let mockElectedOffice: {
  data: { id: number } | null | undefined
  isPending: boolean
} = { data: null, isPending: false }
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => mockElectedOffice,
}))

// The free robocall offer, as gp-api answers it. Not offered by default.
let mockFreeOffer: { offer: { eligible: true } | null } = { offer: null }
vi.mock('app/dashboard/shared/robocallFreeOffer/useRobocallFreeOffer', () => ({
  useRobocallFreeOffer: () => mockFreeOffer,
}))

const renderGrid = (
  overrides: Partial<{
    onCreateSocial: () => void
    onCreateSms: (preselect?: AudiencePreselect) => void
    onCreateRobocall: (preselect?: AudiencePreselect) => void
    onCreatePhoneBanking: (preselect?: AudiencePreselect) => void
    onCreateEmail: () => void
    preselectedListId: number
    preselectedRecommendedVariant: RecommendedListVariant
  }> = {},
) =>
  render(
    <ChannelTileGrid
      preselectedListId={overrides.preselectedListId}
      preselectedRecommendedVariant={overrides.preselectedRecommendedVariant}
      onCreateSocial={overrides.onCreateSocial ?? vi.fn()}
      onCreateSms={overrides.onCreateSms ?? vi.fn()}
      onCreateRobocall={overrides.onCreateRobocall ?? vi.fn()}
      onCreatePhoneBanking={overrides.onCreatePhoneBanking ?? vi.fn()}
      onCreateEmail={overrides.onCreateEmail}
    />,
  )

describe('ChannelTileGrid — social tile', () => {
  it('always opens the new social flow', async () => {
    const onCreateSocial = vi.fn()
    renderGrid({ onCreateSocial })

    await userEvent.click(screen.getByText('Social media'))

    expect(onCreateSocial).toHaveBeenCalledTimes(1)
  })
})

describe('ChannelTileGrid — email tile', () => {
  it('is absent without a handler and opens the email flow with one', async () => {
    const { unmount } = renderGrid()
    expect(screen.queryByText('Email')).not.toBeInTheDocument()
    unmount()

    const onCreateEmail = vi.fn()
    renderGrid({ onCreateEmail })
    await userEvent.click(screen.getByText('Email'))
    expect(onCreateEmail).toHaveBeenCalledTimes(1)
  })
})

describe('ChannelTileGrid — robocall tile', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
  })

  it('opens the robocall flow', async () => {
    const onCreateRobocall = vi.fn()
    renderGrid({ onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).toHaveBeenCalledTimes(1)
  })

  it('tags the tile only while the campaign has the free offer', () => {
    renderGrid()
    expect(screen.queryByText('Free offer')).not.toBeInTheDocument()

    mockFreeOffer = { offer: { eligible: true } }
    renderGrid()
    expect(screen.getByText('Free offer')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Robocall' }).at(-1),
    ).toHaveAccessibleDescription('Free offer')
    mockFreeOffer = { offer: null }
  })

  it('shows the free offer over the lock when both apply', () => {
    mockCampaign = { id: 9, isPro: false }
    mockFreeOffer = { offer: { eligible: true } }
    renderGrid()

    expect(
      screen.getByRole('button', { name: 'Robocall' }),
    ).toHaveAccessibleDescription('Free offer')
    mockFreeOffer = { offer: null }
  })
})

describe('ChannelTileGrid — SMS tile', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockRouterPush.mockClear()
  })

  it('Pro campaign: opens the SMS flow once the text gate passes', async () => {
    const onCreateSms = vi.fn()
    renderGrid({ onCreateSms })

    await userEvent.click(screen.getByText('SMS'))

    expect(onCreateSms).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  // Upgrade-at-entry: a non-Pro click goes to the wizard, not the legacy
  // marketing modal — the same pattern the phone-banking tile set.
  it('non-Pro campaign: redirects to pro-upgrade instead of opening', async () => {
    mockCampaign = { id: 9, isPro: false }
    const onCreateSms = vi.fn()
    renderGrid({ onCreateSms })

    await userEvent.click(screen.getByText('SMS'))

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(onCreateSms).not.toHaveBeenCalled()
  })
})

describe('ChannelTileGrid — SMS tile once gp-api closes texting', () => {
  beforeEach(() => {
    mockRouterPush.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  afterEach(() => {
    proGatingV2.enabled = false
    mockCampaign = { id: 9, isPro: true }
  })

  it('counts down on the tile while the window is closing', () => {
    mockCampaign = {
      id: 9,
      isPro: true,
      smsCompliance: 'closing',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    renderGrid()

    expect(
      screen.getByRole('button', { name: 'SMS' }),
    ).toHaveAccessibleDescription('Verify by Oct. 15')
  })

  it('shows the countdown over the lock when both apply', () => {
    mockCampaign = {
      id: 9,
      isPro: false,
      smsCompliance: 'closing',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    renderGrid()

    expect(
      screen.getByRole('button', { name: 'SMS' }),
    ).toHaveAccessibleDescription('Verify by Oct. 15')
  })

  it.each([
    ['off', false, true],
    ['off', false, false],
    ['on', true, false],
  ])(
    'explains the closed tile on hover and opens nothing (flag %s, Pro %s)',
    async (_label, flagOn, isPro) => {
      const user = userEvent.setup()
      proGatingV2.enabled = flagOn
      mockCampaign = {
        id: 9,
        isPro,
        smsCompliance: 'closed',
        smsCutoffDate: '2026-10-15',
        generalElectionDate: '2026-11-03',
      }
      const onCreateSms = vi.fn()
      renderGrid({ onCreateSms })

      expect(screen.getByText('Not available for this race')).toBeVisible()
      await user.hover(screen.getByText('SMS'))

      expect(
        (
          await screen.findAllByText(
            'The Oct. 15 deadline to get verified for texting has passed.',
          )
        ).length,
      ).toBeGreaterThan(0)

      await user.click(screen.getByText('SMS'))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onCreateSms).not.toHaveBeenCalled()
      expect(mockRouterPush).not.toHaveBeenCalled()
      expect(trackEvent).not.toHaveBeenCalled()
    },
  )
})

// ENG-10920: tile handler matrix — pro / non-pro / electedOffice / pending
// asserting open vs redirect.
describe('ChannelTileGrid — phone-banking tile + Pro redirect', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
  })

  it('Pro campaign: opens the new PhoneBankingFlow', async () => {
    mockCampaign = { id: 9, isPro: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('non-Pro campaign: redirects to pro-upgrade, no modal', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(onCreatePhoneBanking).not.toHaveBeenCalled()
  })

  it('elected official (no Pro sub): opens the flow', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('elected official (no Pro sub): tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: { id: 1 }, isPending: false }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')
  })

  it('non-Pro + pending elected-office state: tile is not visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')
  })

  it('non-Pro, no elected office: tile is visually locked', () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    renderGrid()

    expect(
      screen.getByText('Phone banking').closest('button'),
    ).toHaveAccessibleDescription('Pro')
  })

  it('non-Pro + pending elected-office state: does not redirect', async () => {
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: undefined, isPending: true }
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
  })
})

// Door knocking is the one tile that navigates rather than opening a flow in
// place, so the selected list has to survive the navigation or "start a walk
// from this list" lands the candidate back on the picker they came from.
describe('ChannelTileGrid — door-knocking tile carries the selected list', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
    testQueryClient.clear()
    packFetches.count = 0
  })

  // The district download is the slowest read the product has (p50 4.5s, p95
  // 33.6s in prod) and every count in the create flow is arithmetic over it, so
  // the flow's first two steps are a dead Continue for as long as it runs. This
  // is the only place that wait can be started before it is being waited on:
  // the route transition and the map chunk are a head start the far side of the
  // navigation cannot give itself.
  it('starts the district download before navigating to the flow', async () => {
    renderGrid()

    await userEvent.click(screen.getByText('Door knocking'))

    await waitFor(() => expect(packFetches.count).toBe(1))
    // And the flow re-uses it rather than asking again — same key, and
    // `staleTime: Infinity` on the query the page mounts.
    expect(
      testQueryClient.getQueryState(voterPackQueryOptions.queryKey),
    ).toBeDefined()
  })

  it('does not touch the pack for a tile that is not door knocking', async () => {
    renderGrid()

    await userEvent.click(screen.getByText('SMS'))

    expect(packFetches.count).toBe(0)
  })

  it('carries the preselected list as ?listId=', async () => {
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page&listId=42',
    )
  })

  it('navigates bare when no list is selected', async () => {
    renderGrid()

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page',
    )
  })

  it('leaves the list intact for another tile when door knocking was not pressed', async () => {
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ preselectedListId: 42, onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Social media'))
    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledWith({ listId: 42 })
  })

  // The instance can outlive the navigation in the App Router's soft-nav
  // cache, so a list handed to door knocking has to be spent on the way out
  // — otherwise a Back to this hub aims the next tile pressed at a list the
  // candidate chose for a walk.
  it('spends the list on the way out, so a later tile opens clean', async () => {
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ preselectedListId: 42, onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Door knocking'))
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page&listId=42',
    )

    // Phone banking is the one remaining tile that APPLIES a preselect, so
    // it's where a leftover id would show up as a real preselection.
    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledWith(undefined)
  })

  // The tile is Pro-locked, and carrying a list must not become a way past
  // that: a non-Pro click still gets the upgrade modal and goes nowhere.
  it('shows the Pro modal instead of navigating for a non-Pro campaign', async () => {
    mockCampaign = { id: 9, isPro: false }
    renderGrid({ preselectedListId: 42 })

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(
      await screen.findByText('Get Pro voter data and tools'),
    ).toBeInTheDocument()
  })
})

// ENG-11020: phone banking opens in the hub (not here), so the list travels
// through the open callback — and is spent on hand-off, exactly like door
// knocking spends it on the way out, so no later tile inherits it.
describe('ChannelTileGrid — phone-banking tile carries the selected list', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
  })

  it('hands the preselected list to the open callback', async () => {
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ preselectedListId: 42, onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledWith({ listId: 42 })
  })

  it('spends the list on hand-off, so a later open starts clean', async () => {
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ preselectedListId: 42, onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))
    expect(onCreatePhoneBanking).toHaveBeenNthCalledWith(1, { listId: 42 })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenNthCalledWith(2, undefined)
  })

  // The Pro redirect happens before the hand-off: the candidate never
  // entered the flow, so the deep-linked list must survive for whichever
  // tile they press after coming back.
  it('does not spend the list on a non-Pro redirect', async () => {
    mockCampaign = { id: 9, isPro: false }
    const onCreatePhoneBanking = vi.fn()
    const { rerender } = renderGrid({
      preselectedListId: 42,
      onCreatePhoneBanking,
    })

    await userEvent.click(screen.getByText('Phone banking'))
    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(onCreatePhoneBanking).not.toHaveBeenCalled()

    // Coming back upgraded: the list the deep link carried is still there.
    mockCampaign = { id: 9, isPro: true }
    rerender(
      <ChannelTileGrid
        preselectedListId={42}
        onCreateSocial={vi.fn()}
        onCreateSms={vi.fn()}
        onCreateRobocall={vi.fn()}
        onCreatePhoneBanking={onCreatePhoneBanking}
      />,
    )
    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledWith({ listId: 42 })
  })
})

// A list carried in on ?listId= used to reach only phone banking and door
// knocking; the SMS and robocall tiles opened their flows with nothing, so a
// voter data page "Send outreach" that picked either lost its list.
describe('ChannelTileGrid — the preselect reaches every audience-taking tile', () => {
  beforeEach(() => {
    mockCampaign = { id: 9, isPro: true }
    mockRouterPush.mockClear()
  })

  it('hands the carried list to the SMS flow', async () => {
    const onCreateSms = vi.fn()
    renderGrid({ preselectedListId: 42, onCreateSms })

    await userEvent.click(screen.getByText('SMS'))

    expect(onCreateSms).toHaveBeenCalledWith({ listId: 42 })
  })

  it('hands the carried list to the robocall flow', async () => {
    const onCreateRobocall = vi.fn()
    renderGrid({ preselectedListId: 42, onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).toHaveBeenCalledWith({ listId: 42 })
  })

  it('spends the list once SMS has taken it', async () => {
    const onCreateSms = vi.fn()
    const onCreateRobocall = vi.fn()
    renderGrid({ preselectedListId: 42, onCreateSms, onCreateRobocall })

    await userEvent.click(screen.getByText('SMS'))
    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).toHaveBeenCalledWith(undefined)
  })

  // The voter data page's recommended cards carry a variant instead of a
  // list: nothing is saved until the flow's own audience step.
  it('hands a recommended variant to the flows', async () => {
    const onCreateSms = vi.fn()
    renderGrid({
      preselectedRecommendedVariant: 'persuadeAffinity',
      onCreateSms,
    })

    await userEvent.click(screen.getByText('SMS'))

    expect(onCreateSms).toHaveBeenCalledWith({
      recommendedVariant: 'persuadeAffinity',
    })
  })

  it('carries a recommended variant to door knocking as ?recommended=', async () => {
    renderGrid({ preselectedRecommendedVariant: 'persuadeAffinity' })

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page&recommended=persuadeAffinity',
    )
  })
})

// Milestone 2: the tiles stop being the gate. A free candidate opens the
// flow, builds their campaign, and meets the gate inside it.
describe('ChannelTileGrid — flag on: the tiles open the gated flows', () => {
  beforeEach(() => {
    proGatingV2.enabled = true
    mockCampaign = { id: 9, isPro: false }
    mockElectedOffice = { data: null, isPending: false }
    mockRouterPush.mockClear()
    runTextGate.mockClear()
  })

  afterEach(() => {
    proGatingV2.enabled = false
  })

  it('leaves the text, robocall and phone-banking tiles unlocked for a free candidate', () => {
    renderGrid()

    expect(
      screen.getByText('SMS').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')
    expect(
      screen.getByText('Robocall').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')
    expect(
      screen.getByText('Phone banking').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')
  })

  it('opens the SMS flow for a free candidate instead of the Pro wizard', async () => {
    const onCreateSms = vi.fn()
    renderGrid({ onCreateSms })

    await userEvent.click(screen.getByText('SMS'))

    expect(onCreateSms).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
    // The flow carries the compliance gate now, so the tile no longer runs it.
    expect(runTextGate).not.toHaveBeenCalled()
  })

  it('opens the robocall flow for a free candidate instead of the Pro modal', async () => {
    const onCreateRobocall = vi.fn()
    renderGrid({ onCreateRobocall })

    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateRobocall).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText('Get Pro voter data and tools'),
    ).not.toBeInTheDocument()
  })

  it('opens the phone-banking flow for a free candidate instead of the Pro wizard', async () => {
    const onCreatePhoneBanking = vi.fn()
    renderGrid({ onCreatePhoneBanking })

    await userEvent.click(screen.getByText('Phone banking'))

    expect(onCreatePhoneBanking).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('still spends the carried audience on open', async () => {
    const onCreateSms = vi.fn()
    const onCreateRobocall = vi.fn()
    renderGrid({ preselectedListId: 42, onCreateSms, onCreateRobocall })

    await userEvent.click(screen.getByText('SMS'))
    await userEvent.click(screen.getByText('Robocall'))

    expect(onCreateSms).toHaveBeenCalledWith({ listId: 42 })
    expect(onCreateRobocall).toHaveBeenCalledWith(undefined)
  })

  // Door knocking is a door too: its page admits a free campaign under the
  // flag and its create flow gates Build route.
  it('opens door knocking for a free candidate instead of the Pro modal', async () => {
    renderGrid()

    expect(
      screen.getByText('Door knocking').closest('button'),
    ).not.toHaveAccessibleDescription('Pro')

    await userEvent.click(screen.getByText('Door knocking'))

    expect(mockRouterPush).toHaveBeenCalledWith(
      '/dashboard/door-knocking?create=1&source=outreach_page',
    )
    expect(
      screen.queryByText('Get Pro voter data and tools'),
    ).not.toBeInTheDocument()
  })
})
