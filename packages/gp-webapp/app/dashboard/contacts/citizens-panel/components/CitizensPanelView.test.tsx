import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { CivicPanelRepresentation } from '@goodparty_org/contracts'
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

const REPRESENTATION: CivicPanelRepresentation = {
  representation: {
    respondentCount: 40,
    groups: [
      {
        dimension: 'housing',
        key: 'renters',
        label: 'Rent their home',
        respondentShare: 0.2,
        districtShare: 0.4,
      },
    ],
  },
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
        representation={REPRESENTATION}
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
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.CivicPanel.PanelViewed,
      expect.objectContaining({ howCloseStatus: null }),
    )
  })

  it('says how the panel compares with the district and who to invite next', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
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
        representation={REPRESENTATION}
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
        representation={REPRESENTATION}
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
        representation={REPRESENTATION}
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

    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )
    expect(
      screen.queryByText('How your panel compares with your district'),
    ).not.toBeInTheDocument()
  })

  it('compares the members with the district', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Rent their home')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Rent their home: 20 points under. 20% of members, 40% of your district',
      }),
    ).toBeInTheDocument()
  })

  it('withholds the comparison below the minimum number of members', () => {
    render(
      <CitizensPanelView
        summary={{
          members: 4,
          reachedRecently: 0,
          askableNow: 4,
          lastOutreachAt: null,
        }}
        representation={{ representation: null }}
        plan={PLAN}
      />,
    )

    expect(
      screen.getByText(
        'Once your panel has 10 members, you can compare it with your district.',
      ),
    ).toBeInTheDocument()
  })

  it('says when too few members can be placed on the map', () => {
    render(
      <CitizensPanelView
        summary={{
          members: 14,
          reachedRecently: 0,
          askableNow: 14,
          lastOutreachAt: null,
        }}
        representation={{ representation: null }}
        plan={PLAN}
      />,
    )

    expect(
      screen.getByText(
        'Not enough members have an address we can map yet. This fills in as more people join.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Once your panel has/)).not.toBeInTheDocument()
  })

  it('offers no list of who can be asked now', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

    expect(
      screen.queryByRole('link', { name: /who can be asked now/ }),
    ).not.toBeInTheDocument()
  })

  it('opens the built-in panel list, saving nothing', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

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
        representation={{ representation: null }}
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
