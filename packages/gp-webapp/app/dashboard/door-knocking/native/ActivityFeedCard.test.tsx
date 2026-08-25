import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { RouteTargetActivity } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import ActivityFeedCard from './ActivityFeedCard'

const doorKnock = (
  overrides: Partial<
    Extract<RouteTargetActivity, { type: 'DOOR_KNOCK' }>['data']
  > = {},
  date = '2026-08-10T15:00:00.000Z',
): RouteTargetActivity => ({
  type: 'DOOR_KNOCK',
  date,
  data: {
    activityId: 'dk-1',
    outcome: 'answered',
    supportAnswer: 'supporter',
    note: null,
    manual: false,
    ...overrides,
  },
})

const card = () =>
  screen.getByRole('heading', { name: 'Activity feed' }).parentElement!

describe('ActivityFeedCard', () => {
  // "We have never been here" is a thing the card has to say out loud. An
  // empty card reads as a component that failed to load.
  it('says a resident has no previous outreach rather than rendering nothing', () => {
    render(<ActivityFeedCard history={[]} />)

    expect(
      within(card()).getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()
  })

  it('renders attempts newest first, in the order the server sent them', () => {
    render(
      <ActivityFeedCard
        history={[
          doorKnock({ activityId: 'dk-new' }, '2026-08-12T15:00:00.000Z'),
          {
            type: 'TEXT',
            date: '2026-08-05T15:00:00.000Z',
            data: {
              activityId: 'tx-1',
              respondedAt: null,
              optedOutAt: null,
              note: null,
              manual: false,
              outreachId: null,
            },
          },
          doorKnock({ activityId: 'dk-old' }, '2026-07-01T15:00:00.000Z'),
        ]}
      />,
    )

    const rendered = within(card())
      .getAllByText(/Door Knock:|^Text$/)
      .map((node) => node.textContent)
    expect(rendered).toEqual([
      'Door Knock: Answered',
      'Text',
      'Door Knock: Answered',
    ])
  })

  // The whole reason for reusing the CRM's rows: the same event must not read
  // one way in Contacts and another at the door.
  it('names a status change with the CRM feed vocabulary', () => {
    render(
      <ActivityFeedCard
        history={[
          {
            type: 'STATUS_CHANGE',
            date: '2026-08-11T15:00:00.000Z',
            data: {
              activityId: 'se-1',
              field: 'not_a_voter',
              fromLabel: null,
              toLabel: 'Moved away',
              actorName: 'Rosa Iyer',
              actorUserId: 77,
              source: 'manual',
            },
          },
        ]}
      />,
    )
    const rendered = within(card())

    expect(rendered.getByText('Not A Voter updated')).toBeInTheDocument()
    expect(
      rendered.getByText("Rosa Iyer set Not A Voter to 'Moved away'"),
    ).toBeInTheDocument()
  })

  it('draws each channel already in the CRM', () => {
    render(
      <ActivityFeedCard
        history={[
          doorKnock(),
          {
            type: 'TEXT',
            date: '2026-08-09T15:00:00.000Z',
            data: {
              activityId: 'tx-1',
              respondedAt: null,
              optedOutAt: null,
              note: null,
              manual: false,
              outreachId: null,
            },
          },
          {
            type: 'ROBOCALL',
            date: '2026-08-08T15:00:00.000Z',
            data: {
              activityId: 'rc-1',
              answeredAt: null,
              voicemailLeftAt: null,
              note: null,
              manual: false,
              outreachId: null,
            },
          },
          {
            type: 'PHONE_BANKING',
            date: '2026-08-07T15:00:00.000Z',
            data: {
              activityId: 'pb-1',
              outcome: 'answered',
              supportAnswer: 'supporter',
              willVote: 'yes',
              note: null,
              manual: false,
            },
          },
        ]}
      />,
    )
    const rendered = within(card())

    expect(rendered.getByText('Door Knock: Answered')).toBeInTheDocument()
    expect(rendered.getByText('Text')).toBeInTheDocument()
    expect(rendered.getByText('Robocall')).toBeInTheDocument()
    expect(rendered.getByText('No answer')).toBeInTheDocument()
    expect(rendered.getByText('Phone Banking: Answered')).toBeInTheDocument()
  })

  // Leaving the walk in the same tab unmounts WalkView, and with it the
  // per-target replay keys that let a retried knock upsert rather than
  // duplicate. Everything else that leaves this page opens a new tab.
  it('offers no navigation out of the walk for outreach-linked rows', () => {
    render(
      <ActivityFeedCard
        history={[
          {
            type: 'TEXT',
            date: '2026-08-09T15:00:00.000Z',
            data: {
              activityId: 'tx-1',
              respondedAt: null,
              optedOutAt: null,
              note: null,
              manual: false,
              outreachId: 412,
            },
          },
          {
            type: 'ROBOCALL',
            date: '2026-08-08T15:00:00.000Z',
            data: {
              activityId: 'rc-1',
              answeredAt: null,
              voicemailLeftAt: null,
              note: null,
              manual: false,
              outreachId: 412,
            },
          },
        ]}
      />,
    )
    const rendered = within(card())

    expect(rendered.getByText('Text')).toBeInTheDocument()
    expect(rendered.getByText('Robocall')).toBeInTheDocument()
    expect(rendered.queryByRole('link')).toBeNull()
  })
})
