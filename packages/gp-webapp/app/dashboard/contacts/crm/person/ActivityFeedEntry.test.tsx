import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useUser } from '@shared/hooks/useUser'
import type { ContactImportConstituentActivity } from '@goodparty_org/contracts'
import {
  ContactImportActivityRow,
  DoorKnockActivityRow,
  PhoneBankingActivityRow,
  StatusChangeActivityRow,
  TextActivityRow,
} from './ActivityFeedEntry'
import type {
  DoorKnockConstituentActivity,
  PhoneBankingConstituentActivity,
  TextConstituentActivity,
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

  it('says a constituent joined the civic panel by text, not that someone changed it', () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(
      <StatusChangeActivityRow
        activity={makeActivity({
          field: 'civic_panel',
          fromLabel: 'Not a member',
          toLabel: 'Member',
          actorName: null,
          actorUserId: null,
          source: 'sms',
        })}
      />,
    )

    expect(
      screen.getByText('Joined by replying JOIN to a text'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Someone/)).not.toBeInTheDocument()
  })

  it('names the channel when no one on the team made the change', () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(
      <StatusChangeActivityRow
        activity={makeActivity({
          field: 'civic_panel',
          fromLabel: 'Not a member',
          toLabel: 'Member',
          actorName: null,
          actorUserId: null,
          source: 'door_knock',
        })}
      />,
    )

    expect(
      screen.getByText(
        "A door knock changed Civic panel from 'Not a member' to 'Member'",
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

  it('names the Serve follow-up field, its answer, and when it was logged', () => {
    mockedUseUser.mockReturnValue([
      { id: 99, email: 'other@goodparty.org' } as never,
      vi.fn(),
      false,
    ])

    render(
      <StatusChangeActivityRow
        activity={makeActivity({
          field: 'follow_up',
          fromLabel: 'No',
          toLabel: 'Yes',
          source: 'phone_banking',
        })}
      />,
    )

    expect(screen.getByText('Follow-up updated')).toBeInTheDocument()
    expect(
      screen.getByText("Jane Staffer changed Follow-up from 'No' to 'Yes'"),
    ).toBeInTheDocument()
    expect(screen.getByText(/July 20, 2026, at/)).toBeInTheDocument()
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
    followUp: null,
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

describe('a priority answer in the feed', () => {
  const priorityAnswer = {
    priorityId: 'pri_1',
    priorityTitle: 'Safer streets near schools',
    answer: 'yes' as const,
  }
  const expectAnswerLine = (answer: string) => {
    expect(
      screen.getByRole('link', { name: 'Safer streets near schools' }),
    ).toHaveAttribute('href', '/dashboard/priorities/pri_1')
    expect(screen.getByText(answer)).toBeInTheDocument()
    expect(document.body.textContent).toContain(
      `Answered Safer streets near schools: ${answer}`,
    )
  }

  const text = (
    priority: TextConstituentActivity['data']['priorityAnswer'],
  ): TextConstituentActivity => ({
    type: 'TEXT',
    date: '2026-10-12T15:00:00.000Z',
    data: {
      activityId: 'tx_1',
      respondedAt: '2026-10-12T16:00:00.000Z',
      optedOutAt: null,
      note: null,
      manual: false,
      outreachId: 4,
      replies: ['Yes please, the crossing is dangerous.'],
      priorityAnswer: priority,
    },
  })

  it('names the priority a text reply answered, with the coded answer', () => {
    render(<TextActivityRow activity={text(priorityAnswer)} />)

    expect(
      screen.getByText(/Yes please, the crossing is dangerous\./),
    ).toBeInTheDocument()
    expectAnswerLine('Yes')
  })

  it('reads a reply that was not an answer as a question asked', () => {
    render(
      <TextActivityRow
        activity={text({ ...priorityAnswer, answer: 'not_an_answer' })}
      />,
    )

    expect(document.body.textContent).toContain(
      'Asked about Safer streets near schools: No clear answer',
    )
  })

  it('shows a reply with no coded answer as just the reply', () => {
    render(<TextActivityRow activity={text(null)} />)

    expect(screen.queryByText(/Answered/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Safer/ }),
    ).not.toBeInTheDocument()
  })

  it('names the priority a call answered', () => {
    mockedUseUser.mockReturnValue([null as never, vi.fn(), false])
    const call: PhoneBankingConstituentActivity = {
      type: 'PHONE_BANKING',
      date: '2026-10-13T15:00:00.000Z',
      data: {
        activityId: 'pb_1',
        outcome: 'answered',
        supportAnswer: null,
        willVote: null,
        followUp: null,
        note: null,
        manual: false,
        actorName: null,
        actorUserId: null,
        priorityAnswer: { ...priorityAnswer, answer: 'no' },
      },
    }

    render(<PhoneBankingActivityRow activity={call} />)

    expectAnswerLine('No')
  })

  it('names the priority a knock answered', () => {
    const knock: DoorKnockConstituentActivity = {
      type: 'DOOR_KNOCK',
      date: '2026-10-14T15:00:00.000Z',
      data: {
        activityId: 'dk_1',
        outcome: 'answered',
        supportAnswer: null,
        followUp: null,
        note: null,
        manual: false,
        actorName: null,
        actorUserId: null,
        priorityAnswer: { ...priorityAnswer, answer: 'mixed' },
      },
    }

    render(<DoorKnockActivityRow activity={knock} />)

    expectAnswerLine('Mixed')
  })
})

const makeImport = (
  overrides: Partial<ContactImportConstituentActivity['data']> = {},
): ContactImportConstituentActivity => ({
  type: 'CONTACT_IMPORT',
  date: '2026-10-29T15:41:00.000Z',
  data: {
    activityId: 'row-1',
    uploadId: 'upload-1',
    uploadName: 'Newsletter',
    isNewPerson: false,
    isFirstImport: false,
    suppliedFields: ['firstName', 'lastName', 'email', 'cellPhone'],
    changedFields: [],
    manual: false,
    actorName: null,
    actorUserId: null,
    ...overrides,
  },
})

describe('<ContactImportActivityRow>', () => {
  it('names the supplied fields on the upload that brought a person in', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({ isFirstImport: true })}
      />,
    )

    expect(
      screen.getByText('First name, last name, email and cell phone added'),
    ).toBeInTheDocument()
    expect(screen.getByText('Imported from Newsletter.')).toBeInTheDocument()
  })

  it('names only what a later upload changed', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({ changedFields: ['email'] })}
      />,
    )

    expect(screen.getByText('Email updated')).toBeInTheDocument()
  })

  it('says a re-import that changed nothing changed nothing', () => {
    render(<ContactImportActivityRow isWin={false} activity={makeImport()} />)

    expect(screen.getByText('Nothing changed')).toBeInTheDocument()
    expect(screen.queryByText(/added$/)).not.toBeInTheDocument()
  })

  it('says only the upload that created a person added them', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({ isNewPerson: true, isFirstImport: true })}
      />,
    )

    expect(
      screen.getByText('Added as a new person from Newsletter.'),
    ).toBeInTheDocument()
  })

  it('reads a later upload of a created person as an import', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({ isNewPerson: true })}
      />,
    )

    expect(screen.getByText('Imported from Newsletter.')).toBeInTheDocument()
    expect(screen.queryByText(/as a new person/)).not.toBeInTheDocument()
  })

  it('says the user added a person they chose New person for', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({
          isNewPerson: true,
          isFirstImport: true,
          manual: true,
        })}
      />,
    )

    expect(
      screen.getByText('First name, last name, email and cell phone added'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('You added them as a new person from Newsletter.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Matched by you')).not.toBeInTheDocument()
  })

  it('says the user matched a row they picked a person for', () => {
    render(
      <ContactImportActivityRow
        isWin={false}
        activity={makeImport({ manual: true })}
      />,
    )

    expect(screen.getByText('Matched by you')).toBeInTheDocument()
    expect(
      screen.getByText('You matched this row from Newsletter.'),
    ).toBeInTheDocument()
  })
})
