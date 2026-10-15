import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { CivicPanelRepresentation } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { CitizensPanelView } from './CitizensPanelView'

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
  progress: { members: 40, goal: 240, answersNeeded: 96, expectedAnswers: 16 },
}

beforeEach(() => {
  testQueryClient.clear()
  vi.clearAllMocks()
})

describe('CitizensPanelView', () => {
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

  it('links who can be asked now into a new list already filtered to them', () => {
    render(
      <CitizensPanelView
        summary={SUMMARY}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

    expect(
      screen.getByRole('link', { name: 'Make a list of who can be asked now' }),
    ).toHaveAttribute('href', '/dashboard/contacts?newList=askableNow')
  })

  it('offers no such list when nobody can be asked now', () => {
    render(
      <CitizensPanelView
        summary={{
          members: 12,
          reachedRecently: 12,
          askableNow: 0,
          lastOutreachAt: null,
        }}
        representation={REPRESENTATION}
        plan={PLAN}
      />,
    )

    expect(
      screen.queryByRole('link', {
        name: 'Make a list of who can be asked now',
      }),
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
