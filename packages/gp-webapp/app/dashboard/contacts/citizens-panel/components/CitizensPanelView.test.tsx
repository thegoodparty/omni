import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  CivicPanelSummary,
  ManagedCivicPanel,
  ManagedCivicPanelStatus,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CitizensPanelView } from './CitizensPanelView'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({
    slug: 'eo-test',
    district: { l2Name: 'ASHEVILLE CITY' },
  }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Ana' }],
}))

interface SurfaceProps {
  open: boolean
  pendingMessage?: string
  analyticsSurface?: string
}
let lastSurfaceProps: SurfaceProps | null = null
vi.mock(
  '../../../chief-of-staff/components/chat/ChiefOfStaffChatSurface',
  () => ({
    default: (props: SurfaceProps) => {
      lastSurfaceProps = props
      return props.open ? <div data-testid="panel-chat" /> : null
    },
  }),
)
vi.mock('../../../chief-of-staff/components/chat/FooterChatBar', () => ({
  default: ({ onOpen }: { onOpen: () => void }) => (
    <div data-testid="footer-chat-bar">
      <button type="button" onClick={onOpen}>
        Open the chat bar
      </button>
    </div>
  ),
}))

// Tract 2 trails its share; women and residents 65 and over trail theirs.
const COMPOSITION = {
  placeKind: 'tract' as const,
  places: [
    {
      key: '37021000100',
      name: '0001.00',
      label: 'Oakdale, around Pine St',
      districtShare: 0.6,
      members: 30,
    },
    { key: '37021000200', name: '0002.00', districtShare: 0.4, members: 10 },
  ],
  groups: [
    { group: 'women' as const, districtShare: 0.52, memberShare: 0.4 },
    { group: 'men' as const, districtShare: 0.48, memberShare: 0.6 },
    { group: 'age65plus' as const, districtShare: 0.2, memberShare: 0.05 },
    { group: 'age18to24' as const, districtShare: 0.1, memberShare: 0.1 },
    { group: 'black' as const, districtShare: 0.1, memberShare: 0.06 },
  ],
}

const SUMMARY: CivicPanelSummary = {
  members: 40,
  reachedRecently: 15,
  askableNow: 25,
  lastOutreachAt: null,
  progress: {
    members: 40,
    goal: 240,
    answersNeeded: 96,
    expectedAnswers: 16,
    groupsCovered: 5,
    groupsTotal: 12,
  },
  balance: null,
  composition: COMPOSITION,
}

const EMPTY: CivicPanelSummary = {
  ...SUMMARY,
  members: 0,
  reachedRecently: 0,
  askableNow: 0,
  progress: { ...SUMMARY.progress, members: 0, expectedAnswers: 0 },
  composition: null,
}

const managed = (
  status: ManagedCivicPanelStatus,
  progress: Partial<ManagedCivicPanel['progress']> = {},
): ManagedCivicPanel => ({
  id: 'mp-1',
  status,
  inviteMessage: 'Hi.',
  consentVersion: 'v1',
  approvedAt: new Date('2026-10-22T18:00:00Z'),
  approvedByUserId: 1,
  goalMembers: 240,
  freeTextCap: 15000,
  freeTextsUsed: 120,
  readyAt: null,
  pausedAt: null,
  stoppedAt: null,
  createdAt: new Date('2026-10-22T18:00:00Z'),
  updatedAt: new Date('2026-10-22T18:00:00Z'),
  progress: {
    members: 40,
    goalMembers: 240,
    wavesSent: 0,
    nextWaveAt: null,
    firstSendDate: '2026-11-04',
    readyWeekOf: '2099-11-09',
    ...progress,
  },
})

beforeEach(() => {
  testQueryClient.clear()
  vi.clearAllMocks()
  lastSurfaceProps = null
})

describe('CitizensPanelView', () => {
  it('records the visit with how close the panel is to the district', () => {
    render(
      <CitizensPanelView
        summary={{
          ...SUMMARY,
          balance: { status: 'missingGroups', inviteMore: 'age65plus' },
        }}
      />,
    )

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.CivicPanel.PanelViewed, {
      members: 40,
      goalMembers: 240,
      expectedAnswers: 16,
      answersFloor: 96,
      groupsCovered: 5,
      groupsTotal: 12,
      howCloseStatus: 'missing_groups',
      entry: 'direct',
    })
  })

  it('records no status while the comparison is hidden', () => {
    render(<CitizensPanelView summary={SUMMARY} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CivicPanel.PanelViewed,
      expect.objectContaining({ howCloseStatus: null }),
    )
  })

  it('starts with the empty seats and when the first invites go out', () => {
    render(<CitizensPanelView summary={EMPTY} managed={managed('building')} />)

    expect(
      screen.getByRole('heading', { name: 'Your civic panel starts here' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Who joins first' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your first invites go out Wednesday, November 4. As residents reply, they take their seats here, and you'll see which parts of Asheville we still need to hear from.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Too few members yet')).not.toBeInTheDocument()
    expect(screen.queryByTestId('civic-panel-next')).not.toBeInTheDocument()
  })

  it('names the groups furthest below their share, never telling the official to invite', () => {
    render(
      <CitizensPanelView summary={SUMMARY} managed={managed('building')} />,
    )

    expect(
      screen.getByRole('heading', { name: 'Your civic panel is filling up' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('40 of 240 residents have joined so far.'),
    ).toBeInTheDocument()
    const next = screen.getByTestId('civic-panel-next')
    expect(
      within(next).getByRole('heading', { name: "Who we're inviting next" }),
    ).toBeInTheDocument()
    expect(
      within(next).getByText(
        'These groups have fewer seats than their share of Asheville, so the next invites lean toward them.',
      ),
    ).toBeInTheDocument()
    const rows = within(next).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('People 65 and over')
    expect(rows[0]).toHaveTextContent('1 of 20 seats')
    expect(next).not.toHaveTextContent(/invite more/i)
    expect(next).not.toHaveTextContent('0002.00')
    expect(screen.queryByText('Furthest behind')).not.toBeInTheDocument()
    expect(screen.queryByTestId('civic-panel-bloom')).not.toBeInTheDocument()
  })

  it('expands every group in place, naming tracts by place', async () => {
    const user = userEvent.setup()
    render(<CitizensPanelView summary={SUMMARY} />)

    await user.click(screen.getByRole('button', { name: 'See every group' }))

    const next = screen.getByTestId('civic-panel-next')
    expect(within(next).getAllByRole('listitem').length).toBeGreaterThan(4)
    expect(
      within(next).getByText('Oakdale, around Pine St'),
    ).toBeInTheDocument()
    expect(within(next).getByText('A part of Asheville')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'See every group' }),
    ).not.toBeInTheDocument()
  })

  it('says which groups are still short once everyone we can text is invited', () => {
    render(
      <CitizensPanelView summary={SUMMARY} managed={managed('exhausted')} />,
    )

    expect(
      screen.getByRole('heading', {
        name: 'Every resident we can text has an invite',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Groups still short' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Everyone we can text has been invited. These groups have fewer seats than their share of Asheville.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the full panel with no list of who is next', () => {
    render(
      <CitizensPanelView
        summary={{
          ...SUMMARY,
          members: 250,
          progress: { ...SUMMARY.progress, members: 250 },
        }}
        managed={managed('ready')}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'Your civic panel is ready' }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('civic-panel-next')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Your civic panel is full. We keep it fresh as people come and go.',
      ),
    ).toBeInTheDocument()
  })

  it('puts the invites, numbers and See members in the rail', () => {
    render(
      <CitizensPanelView summary={SUMMARY} managed={managed('building')} />,
    )

    const aside = screen.getByTestId('civic-panel-aside')
    expect(
      within(aside).getByRole('heading', { name: 'Invites' }),
    ).toBeInTheDocument()
    expect(within(aside).getByText('Members')).toBeInTheDocument()
    expect(within(aside).getByText('Ready to ask')).toBeInTheDocument()
    expect(
      within(aside).getByText('Not texted in the last 30 days'),
    ).toBeInTheDocument()
    expect(
      within(aside).queryByText('Reached in the last 30 days'),
    ).not.toBeInTheDocument()
    expect(
      within(aside).getByRole('link', { name: 'See members' }),
    ).toHaveAttribute('href', '/dashboard/contacts/lists/civicPanel')
  })

  it('keeps working without a managed panel, minus the invites', () => {
    render(<CitizensPanelView summary={SUMMARY} />)

    expect(screen.getByTestId('civic-panel-hero')).toBeInTheDocument()
    expect(screen.getByTestId('civic-panel-next')).toBeInTheDocument()
    expect(screen.queryByTestId('managed-panel-controls')).toBeNull()
  })

  it('offers no members list when nobody has joined', () => {
    render(<CitizensPanelView summary={EMPTY} />)

    expect(
      screen.queryByRole('link', { name: 'See members' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "As residents reply, they take their seats here, and you'll see which parts of Asheville we still need to hear from.",
      ),
    ).toBeInTheDocument()
  })

  it('pins the Chief of Staff bar, and asks it about the panel from the rail', async () => {
    const user = userEvent.setup()
    render(<CitizensPanelView summary={SUMMARY} />)

    expect(screen.getByTestId('footer-chat-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-chat')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Ask about your civic panel' }),
    )

    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
    expect(lastSurfaceProps).toMatchObject({
      pendingMessage: 'How is my civic panel doing?',
      analyticsSurface: 'civic_panel_dock',
    })
  })

  it('opens a plain chat from the bar', async () => {
    const user = userEvent.setup()
    render(<CitizensPanelView summary={SUMMARY} />)

    await user.click(screen.getByRole('button', { name: 'Open the chat bar' }))

    expect(screen.getByTestId('panel-chat')).toBeInTheDocument()
    expect(lastSurfaceProps?.pendingMessage).toBeUndefined()
  })
})
