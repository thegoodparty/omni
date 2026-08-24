import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { Campaign } from 'helpers/types'
import TaskFlow from './TaskFlow'

// ENG-10767: end-to-end attribution through the flow shell — the audience
// step reports how the audience was chosen, and TaskFlow carries it onto the
// audience-step Next event and the Campaign Completed event. The heavy step
// children are mocked; AudienceStep itself is real so the test exercises the
// actual reporting path (manual pick vs deep-linked preselect).

const mockClientRequest = vi.fn()

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => mockClientRequest(...args),
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('@shared/utils/Modal', () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div data-testid="task-flow-modal">{children}</div> : null),
}))
vi.mock('./InstructionsStep', () => ({
  default: ({ nextCallback }: { nextCallback: () => void }) => (
    <button onClick={nextCallback}>intro next</button>
  ),
}))
vi.mock('./AddScriptStep/AddScriptStep', () => ({
  default: ({ nextCallback }: { nextCallback: () => void }) => (
    <button onClick={nextCallback}>script next</button>
  ),
}))
vi.mock('./ScheduleStep', () => ({
  default: ({
    onScheduleOutreach,
  }: {
    onScheduleOutreach: (outreach: { id: number }) => Promise<boolean>
  }) => (
    <button onClick={() => void onScheduleOutreach({ id: 5 })}>
      schedule now
    </button>
  ),
}))
vi.mock('./ImageStep', () => ({ default: () => null }))
vi.mock('./DownloadStep', () => ({ default: () => null }))
vi.mock('./SocialPostStep', () => ({ default: () => null }))
vi.mock('./CloseConfirmModal', () => ({ default: () => null }))
vi.mock('./PurchaseStep', () => ({ PurchaseStep: () => null }))
vi.mock('app/dashboard/purchase/components/CheckoutSessionProvider', () => ({
  CheckoutSessionProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))
vi.mock('app/dashboard/outreach/components/OutreachCreateCards', () => ({
  OUTREACH_OPTIONS: [],
}))
vi.mock('app/dashboard/outreach/hooks/OutreachContext', () => ({
  useOutreach: () => [[], vi.fn()],
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))
// AudienceStep's count effect reads the org's resolved district (both count paths
// resolve one server-side, so without it they could only 400).
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Mayor',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }),
}))
vi.mock('@shared/hooks/VoterContactsProvider', () => ({
  getVoterContactField: () => 'calls',
}))
vi.mock('@shared/hooks/useVoterContacts', () => ({
  useVoterContacts: () => [{}, vi.fn().mockResolvedValue(undefined)],
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, hasFreeTextsOffer: false }],
}))
vi.mock(
  'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters',
  () => ({
    default: () => null,
    TRACKING_KEYS: { scheduleCampaign: 'scheduleCampaign' },
  }),
)
vi.mock('app/dashboard/components/tasks/flows/RecordCount', () => ({
  countVoterFile: vi.fn().mockResolvedValue(150),
}))

const campaign = { id: 1, aiContent: {} } as unknown as Campaign

const savedList = { id: 42, name: 'My Super Voters' }

const eventCalls = (event: string) =>
  vi.mocked(trackEvent).mock.calls.filter(([name]) => name === event)

const mockAudienceRequests = () => {
  mockClientRequest.mockImplementation((route: string) => {
    if (route === 'GET /v1/voters/voter-file/filters') {
      return Promise.resolve({ data: [savedList] })
    }
    if (route === 'GET /v1/contacts/list-detail') {
      // ENG-10799: the audience step now reads the channel-eligible
      // reachability leaf (reachability.robocall for this describe block's
      // robocall flows) instead of demographics.people.
      return Promise.resolve({
        data: {
          demographics: { people: 100 },
          reachability: { robocall: 100 },
        },
      })
    }
    return Promise.resolve({ data: [] })
  })
}

beforeEach(() => {
  vi.mocked(trackEvent).mockClear()
  mockClientRequest.mockReset()
  mockAudienceRequests()
})

describe('TaskFlow — ENG-10767 audience attribution (robocall)', () => {
  it('carries audienceSource + listId from a manual saved-list pick onto the audience Next and Campaign Completed events', async () => {
    render(<TaskFlow forceOpen type="robocall" campaign={campaign} />)

    fireEvent.click(screen.getByText('intro next'))
    // The intro advance carries no audience attribution.
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Next,
      { step: 'intro' },
    )

    await waitFor(() =>
      expect(screen.getByText('Build a new audience')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(
      await screen.findByRole('option', { name: 'My Super Voters' }),
    )
    await waitFor(() =>
      expect(screen.getByText(/Using your saved list/)).toBeInTheDocument(),
    )
    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Next,
        { step: 'audience', audienceSource: 'savedList', listId: 42 },
      ),
    )

    fireEvent.click(await screen.findByText('script next'))
    fireEvent.click(await screen.findByText('schedule now'))

    await waitFor(() =>
      expect(
        eventCalls(EVENTS.Dashboard.VoterContact.CampaignCompleted),
      ).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.VoterContact.CampaignCompleted,
      {
        medium: 'robocall',
        price: 0,
        voterContacts: 0,
        audienceSource: 'savedList',
        listId: 42,
      },
    )
  })

  it('attributes a deep-linked preselected list as audienceSource deepLink', async () => {
    render(
      <TaskFlow
        forceOpen
        type="robocall"
        campaign={campaign}
        preselectedListId={42}
      />,
    )

    fireEvent.click(screen.getByText('intro next'))

    // ENG-10763's consume-once preselect applies the CRM link's list without
    // any manual pick.
    await waitFor(() =>
      expect(screen.getByText(/Using your saved list/)).toBeInTheDocument(),
    )
    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Next,
        { step: 'audience', audienceSource: 'deepLink', listId: 42 },
      ),
    )

    fireEvent.click(await screen.findByText('script next'))
    fireEvent.click(await screen.findByText('schedule now'))

    await waitFor(() =>
      expect(
        eventCalls(EVENTS.Dashboard.VoterContact.CampaignCompleted),
      ).toHaveLength(1),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.VoterContact.CampaignCompleted,
      {
        medium: 'robocall',
        price: 0,
        voterContacts: 0,
        audienceSource: 'deepLink',
        listId: 42,
      },
    )
  })

  it('omits the attribution properties entirely before the audience step reports (no stale ref leakage)', async () => {
    render(<TaskFlow forceOpen type="robocall" campaign={campaign} />)

    fireEvent.click(screen.getByText('intro next'))
    const introNextCall = eventCalls(
      EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Next,
    )[0]!
    expect(introNextCall[1]).not.toHaveProperty('audienceSource')
    expect(introNextCall[1]).not.toHaveProperty('listId')
  })
})
