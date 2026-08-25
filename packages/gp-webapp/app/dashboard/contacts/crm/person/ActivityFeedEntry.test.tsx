import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useUser } from '@shared/hooks/useUser'
import {
  PhoneBankingActivityRow,
  StatusChangeActivityRow,
} from './ActivityFeedEntry'
import type {
  PhoneBankingConstituentActivity,
  StatusChangeConstituentActivity,
} from '../shared/contacts-types'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: vi.fn(),
}))

const mockedUseUser = vi.mocked(useUser)

const makeActivity = (
  overrides: Partial<StatusChangeConstituentActivity['data']> = {},
): StatusChangeConstituentActivity => ({
  type: 'STATUS_CHANGE',
  date: '2026-07-20T10:00:00.000Z',
  data: {
    activityId: 'sce_1',
    field: 'support_status',
    fromLabel: 'Support unknown',
    toLabel: 'Supporter',
    actorName: 'Jane Staffer',
    actorUserId: 7,
    source: 'manual',
    ...overrides,
  },
})

describe('<StatusChangeActivityRow>', () => {
  it("renders the field-updated title and the actor's name when the viewer did not make the change", () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(<StatusChangeActivityRow activity={makeActivity()} />)

    expect(screen.getByText('Support Status updated')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Jane Staffer changed Support Status from 'Support unknown' to 'Supporter'",
      ),
    ).toBeInTheDocument()
  })

  it('renders "You" when the viewing user made the change', () => {
    mockedUseUser.mockReturnValue([
      { id: 7, email: 'viewer@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(<StatusChangeActivityRow activity={makeActivity()} />)

    expect(
      screen.getByText(
        "You changed Support Status from 'Support unknown' to 'Supporter'",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Jane Staffer/)).not.toBeInTheDocument()
  })

  it('renders "set ... to" (not "from") for the never-seen-before edge (fromLabel null)', () => {
    mockedUseUser.mockReturnValue([null, vi.fn(), false])

    render(
      <StatusChangeActivityRow
        activity={makeActivity({
          field: 'voter_likelihood',
          fromLabel: null,
          toLabel: 'Likely',
        })}
      />,
    )

    expect(screen.getByText('Voter Likelihood updated')).toBeInTheDocument()
    expect(
      screen.getByText("Jane Staffer set Voter Likelihood to 'Likely'"),
    ).toBeInTheDocument()
  })

  it('falls back to "Someone" when there is no actor name and the viewer is not the actor', () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(
      <StatusChangeActivityRow
        activity={makeActivity({ actorName: null, actorUserId: null })}
      />,
    )

    expect(
      screen.getByText(
        "Someone changed Support Status from 'Support unknown' to 'Supporter'",
      ),
    ).toBeInTheDocument()
  })
})

const makePhoneBankingActivity = (
  overrides: Partial<PhoneBankingConstituentActivity['data']> = {},
): PhoneBankingConstituentActivity => ({
  type: 'PHONE_BANKING',
  date: '2026-08-20T10:00:00.000Z',
  data: {
    activityId: 'cipb_1',
    outcome: 'answered',
    supportAnswer: null,
    willVote: null,
    note: null,
    manual: false,
    actorName: 'Jane Staffer',
    actorUserId: 7,
    ...overrides,
  },
})

describe('<PhoneBankingActivityRow>', () => {
  it("renders the actor's name when the viewer did not log the call", () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(<PhoneBankingActivityRow activity={makePhoneBankingActivity()} />)

    expect(screen.getByText('Logged by Jane Staffer')).toBeInTheDocument()
  })

  it('renders "You" when the viewing user logged the call', () => {
    mockedUseUser.mockReturnValue([
      { id: 7, email: 'viewer@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(<PhoneBankingActivityRow activity={makePhoneBankingActivity()} />)

    expect(screen.getByText('Logged by You')).toBeInTheDocument()
    expect(screen.queryByText(/Jane Staffer/)).not.toBeInTheDocument()
  })

  it('renders no author line at all for a legacy null-actor row', () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(
      <PhoneBankingActivityRow
        activity={makePhoneBankingActivity({
          actorName: null,
          actorUserId: null,
        })}
      />,
    )

    expect(screen.queryByText(/^Logged by/)).not.toBeInTheDocument()
  })
})
