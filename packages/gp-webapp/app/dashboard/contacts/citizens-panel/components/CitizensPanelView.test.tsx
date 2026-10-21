import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CitizensPanelView } from './CitizensPanelView'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const SUMMARY = {
  members: 40,
  reachedRecently: 15,
  askableNow: 25,
  lastOutreachAt: null,
}

// Every panel here has a plan, so the cases below are about the members.
const PLAN = {
  plan: null,
  next: null,
  progress: {
    members: 40,
    goal: 240,
    answersNeeded: 96,
    expectedAnswers: 16,
    groupsCovered: 5,
    groupsTotal: 12,
  },
  balance: null,
}

beforeEach(() => {
  testQueryClient.clear()
  vi.clearAllMocks()
})

describe('CitizensPanelView', () => {
  it('records the visit with how close the panel is to the district', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
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
      planStatus: 'none',
      howCloseStatus: 'missing_groups',
      entry: 'direct',
    })
  })

  it('records no status while the comparison is hidden', () => {
    render(<CitizensPanelView summary={SUMMARY} plan={PLAN} />)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CivicPanel.PanelViewed,
      expect.objectContaining({ howCloseStatus: null }),
    )
  })

  it('says how the panel compares with the district and who to invite next', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
          balance: { status: 'missingGroups', inviteMore: 'age65plus' },
        }}
      />,
    )

    expect(
      screen.getByText('How your panel compares with your district'),
    ).toBeInTheDocument()
    expect(screen.getByText('Missing some groups')).toBeInTheDocument()
    expect(
      screen.getByText('Invite more people 65 and over next.'),
    ).toBeInTheDocument()
  })

  it('says how many groups need fresh voices past the goal, and who to invite', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
          balance: {
            status: 'everyGroup',
            inviteMore: 'age65plus',
            groupsNeedingFresh: 3,
          },
        }}
      />,
    )

    expect(
      screen.getByText(
        'Every group on your panel \u00b7 3 groups need fresh voices',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Invite more people 65 and over next.'),
    ).toBeInTheDocument()
  })

  it('says every group has fresh voices once none need them', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
          balance: {
            status: 'everyGroup',
            inviteMore: null,
            groupsNeedingFresh: 0,
          },
        }}
      />,
    )

    expect(screen.getByText('Every group has fresh voices')).toBeInTheDocument()
  })

  it('waits for 30 members before comparing, and hides without the census', () => {
    const { unmount } = render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
          balance: { status: 'tooFewMembers', inviteMore: null },
        }}
      />,
    )
    expect(screen.getByText('Too few members yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        "We'll compare your panel with your district once 30 people join.",
      ),
    ).toBeInTheDocument()
    unmount()

    render(<CitizensPanelView summary={SUMMARY} plan={PLAN} />)
    expect(
      screen.queryByText('How your panel compares with your district'),
    ).not.toBeInTheDocument()
  })

  it('draws the district as seats and the groups as petals', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        plan={{
          ...PLAN,
          balance: { status: 'everyGroup', inviteMore: null },
          composition: {
            placeKind: 'tract',
            places: [
              {
                key: '37021000100',
                name: '1',
                districtShare: 0.6,
                members: 30,
              },
              { key: '37021000200', name: '2', districtShare: 0.4, members: 2 },
            ],
            groups: [
              { group: 'women', districtShare: 0.52, memberShare: 0.6 },
              { group: 'men', districtShare: 0.48, memberShare: 0.4 },
            ],
          },
        }}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: "Who's on your panel, by census tract",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Furthest behind')).toBeInTheDocument()
    expect(
      screen.getByText('Invite more people in tract 2 next.'),
    ).toBeInTheDocument()
    expect(screen.getAllByTestId('civic-panel-bloom')).toHaveLength(1)
    expect(screen.getByText('Every group has its share.')).toBeInTheDocument()
  })

  it('draws no seats without the census', () => {
    render(<CitizensPanelView summary={SUMMARY} plan={PLAN} />)

    expect(screen.queryByTestId('civic-panel-seats')).not.toBeInTheDocument()
  })

  it('offers no list of who can be asked now', () => {
    render(<CitizensPanelView summary={SUMMARY} plan={PLAN} />)

    expect(
      screen.queryByRole('link', { name: /who can be asked now/ }),
    ).not.toBeInTheDocument()
  })

  it('opens the built-in panel list, saving nothing', () => {
    render(<CitizensPanelView summary={SUMMARY} plan={PLAN} />)

    expect(screen.getByRole('link', { name: 'See members' })).toHaveAttribute(
      'href',
      '/dashboard/contacts/lists/civicPanel',
    )
  })

  it('asks the hours question when nobody has joined and there is no plan', () => {
    render(
      <CitizensPanelView
        summary={{
          members: 0,
          reachedRecently: 0,
          askableNow: 0,
          lastOutreachAt: null,
        }}
        plan={PLAN}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: 'How much time can you give each week?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'See members' }),
    ).not.toBeInTheDocument()
  })
})
