import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { CampaignContext } from '@shared/hooks/CampaignProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { OutreachComposeDeepLink } from './OutreachComposeDeepLink'
import { MAX_SMS_CHAR_COUNT } from 'app/dashboard/components/tasks/flows/AddScriptStep/CreateSmSScriptScreen'
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

vi.mock('app/dashboard/components/tasks/flows/TaskFlow', () => ({
  default: ({
    type,
    forceOpen,
    initialScriptText,
    campaignPlanDueDate,
    preselectedListId,
  }: {
    type: string
    forceOpen?: boolean
    initialScriptText?: string
    campaignPlanDueDate?: string
    preselectedListId?: number
  }) => (
    <div
      data-testid="task-flow"
      data-type={type}
      data-force-open={String(forceOpen)}
      data-initial-script={initialScriptText ?? ''}
      data-due-date={campaignPlanDueDate ?? ''}
      data-preselected-list-id={preselectedListId ?? ''}
    />
  ),
}))

// The gate requires a VERIFIED CampaignVerify on top of the approved
// registration (2026-08-28 full-gate decision).
const approvedCompliance = {
  status: 'approved',
  peerlyCvStatus: 'VERIFIED',
} as TcrCompliance
const pendingCompliance = { status: 'pending' } as TcrCompliance

const renderDeepLink = ({
  isPro,
  tcrCompliance,
}: {
  isPro: boolean
  tcrCompliance?: TcrCompliance
}) =>
  render(
    <CampaignContext.Provider value={[{ id: 1, isPro } as Campaign]}>
      <OutreachComposeDeepLink tcrCompliance={tcrCompliance} />
    </CampaignContext.Provider>,
  )

describe('OutreachComposeDeepLink', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    mockReplace.mockClear()
    vi.mocked(trackEvent).mockClear()
  })

  it('opens the text TaskFlow with the decoded preset and consumes the params', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-type', 'text')
    expect(taskFlow).toHaveAttribute('data-force-open', 'true')
    expect(taskFlow).toHaveAttribute('data-initial-script', 'Hello voters')
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.Outreach.ClickCreate, {
      type: 'text',
      source: 'deep_link',
    })
  })

  it('opens the flow with an empty script when message is missing', async () => {
    mockSearchParams = new URLSearchParams('compose=text')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-initial-script', '')
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('clamps the message to the sms script limit', async () => {
    mockSearchParams = new URLSearchParams(
      `compose=text&message=${'a'.repeat(MAX_SMS_CHAR_COUNT + 400)}`,
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow.getAttribute('data-initial-script')).toHaveLength(
      MAX_SMS_CHAR_COUNT,
    )
  })

  it('passes a valid due param through as the campaign-plan due date', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=2026-08-03')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-due-date', '2026-08-03')
  })

  it('ignores a malformed due param', async () => {
    mockSearchParams = new URLSearchParams('compose=text&due=next-tuesday')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-due-date', '')
  })

  it('opens the robocall flow with the due date for a Pro user', async () => {
    mockSearchParams = new URLSearchParams('compose=robocall&due=2026-08-03')
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-type', 'robocall')
    expect(taskFlow).toHaveAttribute('data-due-date', '2026-08-03')
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
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
  })

  it('shows the P2P upgrade modal instead of the flow for a non-Pro user', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: false, tcrCompliance: approvedCompliance })

    expect(
      await screen.findByText('Level the playing field for less'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('shows the compliance modal instead of the flow for a Pro non-compliant user', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters',
    )
    renderDeepLink({ isPro: true, tcrCompliance: pendingCompliance })

    expect(
      await screen.findByText('Texting registration under review'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
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
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
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
        <OutreachComposeDeepLink tcrCompliance={approvedCompliance} />
      </CampaignContext.Provider>,
    )
    expect(mockReplace).toHaveBeenCalledTimes(1)

    mockSearchParams = new URLSearchParams('listId=456')
    view.rerender(
      <CampaignContext.Provider value={[{ id: 1, isPro: true } as Campaign]}>
        <OutreachComposeDeepLink tcrCompliance={approvedCompliance} />
      </CampaignContext.Provider>,
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(2))
    expect(mockReplace).toHaveBeenLastCalledWith('/dashboard/outreach', {
      scroll: false,
    })
  })

  it('consumes both compose and listId together in a single replace, preselecting the list on the TaskFlow it opens', async () => {
    mockSearchParams = new URLSearchParams(
      'compose=text&message=Hello%20voters&listId=123',
    )
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-type', 'text')
    // This component opens its own TaskFlow directly (it never routes
    // through OutreachPage/OutreachCreateCards), so it must parse and carry
    // listId itself rather than relying on the server-threaded prop.
    expect(taskFlow).toHaveAttribute('data-preselected-list-id', '123')
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

    const taskFlow = await screen.findByTestId('task-flow')
    expect(taskFlow).toHaveAttribute('data-preselected-list-id', '')
  })

  it('does nothing without a compose param', async () => {
    renderDeepLink({ isPro: true, tcrCompliance: approvedCompliance })

    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled()
    })
    expect(screen.queryByTestId('task-flow')).not.toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
