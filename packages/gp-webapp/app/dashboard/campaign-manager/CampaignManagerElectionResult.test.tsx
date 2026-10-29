import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { CampaignManagerChatProvider } from './CampaignManagerChatProvider'
import ElectionResultHomeCard from './ElectionResultHomeCard'
import { CAMPAIGN_MANAGER_HISTORY_KEY } from './campaignManagerChat'
import type { ChatSuggestion } from '../chief-of-staff/components/chat/ChiefOfStaffChatBody'

interface SurfaceProps {
  open?: boolean
  initialConversationId?: string | null
  opener?: string[]
  openerKey?: string | null
  suggestions?: ChatSuggestion[]
  quickPrompts?: string[]
  onOpenChange?: (open: boolean) => void
}
const surfaceProps: SurfaceProps[] = []
vi.mock('../chief-of-staff/components/chat/ChiefOfStaffChatSurface', () => ({
  default: (props: SurfaceProps) => {
    surfaceProps.push(props)
    return null
  },
}))
vi.mock('../chief-of-staff/components/chat/FooterChatBar', () => ({
  default: () => null,
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sarah' }],
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Maplewood City Council',
}))
vi.mock('app/dashboard/contacts/citizens-panel/managedPanelCopy', () => ({
  useServePlace: () => 'Maplewood',
}))
vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => false,
}))
vi.mock('app/dashboard/campaign-story/useCampaignStoryComplete', () => ({
  useCampaignStoryComplete: () => ({
    isComplete: true,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))

const campaign = vi.hoisted(() => ({
  current: {
    id: 9,
    details: { electionDate: '2026-11-03' } as Record<string, unknown>,
  },
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaign.current],
}))
vi.mock('helpers/dateHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/dateHelper')>()),
  weeksTill: () => ({ weeks: -1, days: 6 }),
}))

const surface = (): SurfaceProps => surfaceProps.at(-1) as SurfaceProps
const chip = (label: string): ChatSuggestion => {
  const found = surface().suggestions?.find((s) => s.label === label)
  if (!found) throw new Error(`No chip ${label}`)
  return found
}

const setup = () => {
  surfaceProps.length = 0
  testQueryClient.setQueryData(CAMPAIGN_MANAGER_HISTORY_KEY, [
    { conversationId: 'conv-1' },
  ])
  render(
    <CampaignManagerChatProvider>
      <div />
    </CampaignManagerChatProvider>,
  )
}

describe('the campaign manager asks how the election went', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    campaign.current = { id: 9, details: { electionDate: '2026-11-03' } }
    vi.mocked(usePathname).mockReturnValue('/dashboard')
  })

  it('opens on the question, on a new chat, on the manager home', async () => {
    setup()

    await waitFor(() => expect(surface().open).toBe(true))
    expect(surface().initialConversationId).toBeNull()
    expect(surface().opener).toEqual([
      'Election day was November 3. Whatever happened, you ran a real race for Maplewood City Council.',
      'How did it go?',
    ])
    expect(surface().suggestions?.map((s) => s.label)).toEqual([
      'I won',
      "I didn't win",
      "Results aren't final yet",
    ])
    expect(surface().quickPrompts).toEqual([])
  })

  it('opens the election result page on its congratulations for "I won"', async () => {
    setup()
    await waitFor(() => expect(surface().open).toBe(true))

    act(() => chip('I won').onSelect?.())

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/election-result?result=won',
    )
  })

  it('saves a loss and thanks them in the chat with the community', async () => {
    vi.mocked(updateCampaign).mockResolvedValue({ id: 9 } as never)
    setup()
    await waitFor(() => expect(surface().open).toBe(true))

    await act(async () => chip("I didn't win").onSelect?.())

    expect(updateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: false },
    ])
    await waitFor(() =>
      expect(surface().openerKey).toBe('election-result-lost'),
    )
    expect(surface().opener?.[0]).toBe(
      'We appreciate you for running, Sarah. Putting your name on the ballot takes courage. Great work.',
    )
    expect(surface().suggestions?.map((s) => s.label)).toEqual([
      'Join the GoodParty.org community',
    ])
  })

  it('hides the question for 3 days when results are not final', async () => {
    setup()
    await waitFor(() => expect(surface().open).toBe(true))

    act(() => chip("Results aren't final yet").onSelect?.())

    await waitFor(() =>
      expect(surface().openerKey).toBe('election-result-not-final'),
    )
    expect(
      window.localStorage.getItem('gp:electionResultSnoozedUntil'),
    ).toMatch(/^9:\d+$/)
  })

  it('does not ask once the result is saved', async () => {
    campaign.current = {
      id: 9,
      details: { electionDate: '2026-11-03', wonGeneral: true },
    }
    setup()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(surface().open).toBe(false)
    expect(surface().suggestions?.map((s) => s.label)).not.toContain('I won')
  })

  it('waits out a snooze', async () => {
    window.localStorage.setItem(
      'gp:electionResultSnoozedUntil',
      `9:${Date.now() + 60_000}`,
    )
    setup()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(surface().open).toBe(false)
  })

  it('does not open itself away from the manager home', async () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/outreach')
    setup()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(surface().open).toBe(false)
  })
})

describe('the Home card asks while the question is open', () => {
  const renderHome = () => {
    surfaceProps.length = 0
    testQueryClient.setQueryData(CAMPAIGN_MANAGER_HISTORY_KEY, [])
    render(
      <CampaignManagerChatProvider>
        <ElectionResultHomeCard />
      </CampaignManagerChatProvider>,
    )
  }
  const card = () => screen.queryByTestId('election-result-home-card')

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    campaign.current = { id: 9, details: { electionDate: '2026-11-03' } }
    vi.mocked(usePathname).mockReturnValue('/dashboard')
  })

  it('stays on Home after the chat is closed, with the page’s question', async () => {
    renderHome()
    await waitFor(() => expect(surface().open).toBe(true))

    act(() => surface().onOpenChange?.(false))

    expect(
      await screen.findByRole('heading', {
        name: 'Did you win your race for Maplewood City Council?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your election was on November 3. Tell me how it went so I can help with what's next.",
      ),
    ).toBeInTheDocument()
  })

  it('opens the congratulations for "I won"', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'I won' }))

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/election-result?result=won',
    )
  })

  it('saves a loss and goes to the thank you, as the page does', async () => {
    vi.mocked(updateCampaign).mockResolvedValue({ id: 9 } as never)
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: "I didn't win" }))

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/dashboard/election-result/loss',
      ),
    )
    expect(updateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: false },
    ])
  })

  it('goes away for 3 days when results are not final', async () => {
    renderHome()
    fireEvent.click(
      await screen.findByRole('button', { name: "Results aren't final yet" }),
    )

    await waitFor(() => expect(card()).toBeNull())
    expect(
      window.localStorage.getItem('gp:electionResultSnoozedUntil'),
    ).toMatch(/^9:\d+$/)
  })

  it('is not shown once the result is saved', async () => {
    campaign.current = {
      id: 9,
      details: { electionDate: '2026-11-03', wonGeneral: false },
    }
    renderHome()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(card()).toBeNull()
  })

  it('is not shown where the campaign manager chat does not mount', async () => {
    render(<ElectionResultHomeCard />)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(card()).toBeNull()
  })
})
