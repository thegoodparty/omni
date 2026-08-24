import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import {
  DoorKnockOutcome,
  RoutePayloadStop,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import PersonSheet from './PersonSheet'

// The knock form owns the dictation stack and its own mutation; this file is
// about what the sheet itself puts on screen.
vi.mock('./RecordKnockForm', () => ({
  __esModule: true,
  default: () => <div data-testid="record-knock-form" />,
}))

const target = (
  overrides: Partial<RoutePayloadTarget> = {},
): RoutePayloadTarget => ({
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: 'Independent',
  cellPhone: null,
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
  ...overrides,
})

const stop = (targets: RoutePayloadTarget[]): RoutePayloadStop => ({
  id: 10,
  seq: 1,
  lat: 36.16,
  lng: -86.78,
  displayAddress: '105 Elm St',
  legSeconds: 0,
  legMeters: 0,
  addresses: [
    {
      addressKey: '105|elm|st',
      address: '105 Elm St',
      targets,
      otherResidents: [],
    },
  ],
})

// The selection lives in WalkView, so switching resident only works here if
// the harness holds it the same way the walk does.
const Harness = ({ targets }: { targets: RoutePayloadTarget[] }) => {
  const [selectedTargetId, setSelectedTargetId] = useState(
    targets[0]!.stopTargetId,
  )
  return (
    <PersonSheet
      stop={stop(targets)}
      selectedTargetId={selectedTargetId}
      onSelectTarget={setSelectedTargetId}
      statusFor={(candidate) => candidate.knockStatus}
      clientKeyFor={() => 'key'}
      onRecorded={vi.fn()}
      onDoNotKnockChanged={vi.fn()}
      onNotAVoterChanged={vi.fn()}
      onClose={vi.fn()}
    />
  )
}

const renderSheet = (targets: RoutePayloadTarget[]) =>
  render(<Harness targets={targets} />)

const contactCard = () =>
  screen.getByRole('heading', { name: 'Contact information' }).parentElement!

// Aug 14 walkthrough: no step numbers in the list view. Unlike the walk list's
// circle, this one's fill was a constant `bg-info` — the stop's seq was the
// only thing it carried, so the circle went with the numeral.
describe('PersonSheet header', () => {
  it('leads with the person rather than a stop number', () => {
    renderSheet([target()])

    const header = screen.getByRole('heading', { name: 'Dorian Fen' })
      .parentElement!.parentElement!
    // The badge was a span whose entire text was the seq; the age line reads
    // "31 years old · Independent", so it can't be mistaken for one.
    expect(within(header).queryByText('1')).toBeNull()
    expect(
      within(header).getByText('31 years old · Independent'),
    ).toBeInTheDocument()
  })
})

// The door sheet is the one surface used one-handed on a porch, so the two
// layout facts below are behavior rather than styling: which shape it takes at
// which width, and what stays on screen while the body scrolls.
describe('PersonSheet layout', () => {
  const panel = () =>
    screen.getByRole('heading', { name: 'Dorian Fen' }).closest('div.fixed')!

  it('is a bottom drawer below lg and a right-hand sheet at lg', () => {
    renderSheet([target()])
    const classes = panel().className.split(' ')

    expect(classes).toEqual(
      expect.arrayContaining([
        'max-lg:inset-x-0',
        'max-lg:bottom-0',
        'max-lg:max-h-[85dvh]',
        'lg:right-0',
        'lg:top-0',
        'lg:w-[430px]',
      ]),
    )
    // One breakpoint for the whole feature — the landing rail becomes a sheet
    // at `lg` as well, so a second breakpoint here would give the walk two
    // layouts that change at different widths on the same phone.
    expect(
      classes.filter((name) => /^(max-)?(sm|md|xl|2xl):/.test(name)),
    ).toEqual([])
  })

  // The form is pinned to the footer, so logging a door scrolls the body past
  // anything sitting at the top of it. The switcher is the control a canvasser
  // reaches for at exactly that moment — when the person who opened the door
  // turns out to be the housemate — so it sits with the name it changes.
  it('keeps the resident switcher with the name rather than in the scrolling body', () => {
    renderSheet([
      target(),
      target({ stopTargetId: 22, personId: 'person-2', name: 'Marisol Vega' }),
    ])
    const switcher = screen.getByRole('button', { name: /Marisol Vega/ })

    const body = screen
      .getByRole('heading', { name: 'Contact information' })
      .closest('div.overflow-y-auto')!
    expect(body.contains(switcher)).toBe(false)
    expect(
      screen
        .getByRole('heading', { name: 'Dorian Fen' })
        .closest('div.border-b')!
        .contains(switcher),
    ).toBe(true)
  })
})

describe('PersonSheet section headers', () => {
  it('marks each card with a glyph for what it holds', () => {
    renderSheet([target()])

    for (const title of ['Contact information', 'Household', 'Activity feed']) {
      const icon = screen
        .getByRole('heading', { name: title })
        .querySelector('svg')
      expect(icon).toBeInTheDocument()
      // Decorative: the heading is the accessible name, which is also what
      // every other assertion in this file finds these cards by.
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('PersonSheet phone numbers', () => {
  it('shows both numbers as tappable tel links', () => {
    renderSheet([
      target({ cellPhone: '(615) 555-0142', landline: '(615) 555-0199' }),
    ])
    const card = within(contactCard())

    expect(card.getByText('Cell phone')).toBeInTheDocument()
    // Formatting is preserved for reading, stripped for dialing.
    expect(card.getByRole('link', { name: '(615) 555-0142' })).toHaveAttribute(
      'href',
      'tel:6155550142',
    )
    expect(card.getByRole('link', { name: '(615) 555-0199' })).toHaveAttribute(
      'href',
      'tel:6155550199',
    )
  })

  it('omits the row for a number the file does not have', () => {
    renderSheet([target({ cellPhone: '(615) 555-0142' })])
    const card = within(contactCard())

    expect(card.getByText('Cell phone')).toBeInTheDocument()
    expect(card.queryByText('Landline')).toBeNull()
    expect(card.queryByText('No phone number on file.')).toBeNull()
  })

  // Silence would leave the canvasser wondering whether the app failed to load
  // the number or the voter file simply has none.
  it('says so when the file has neither number', () => {
    renderSheet([target()])

    expect(
      within(contactCard()).getByText('No phone number on file.'),
    ).toBeInTheDocument()
  })

  // The stop's own coordinates, not its address text: the route was bought
  // against them, and a geocoder handed the address string is exactly what puts
  // a canvasser on the wrong rural driveway. Google's universal maps URL, so a
  // phone hands off to the Maps app rather than opening a web map — and a new
  // tab, because leaving this one unmounts the walk and its replay keys.
  it('opens the stop in Google Maps at its frozen coordinates', () => {
    renderSheet([target()])

    const link = within(contactCard()).getByRole('link', {
      name: 'Open in Maps',
    })
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=36.16,-86.78',
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  // A mover has no live row at all, which is the same reason the numbers are
  // absent — claiming the file has none would misread the cause, and the moved
  // warning already explains it.
  it('stays quiet about phones for someone who may have moved', () => {
    renderSheet([target({ mayHaveMoved: true })])
    const card = within(contactCard())

    expect(card.queryByText('No phone number on file.')).toBeNull()
    expect(
      card.getByText('May have moved since this route was built.'),
    ).toBeInTheDocument()
  })

  // The sheet switches between people at a multi-resident stop, so the numbers
  // have to follow the selection rather than the stop.
  it('shows the selected person, not the first one', () => {
    renderSheet([
      target({ cellPhone: '(615) 555-0142' }),
      target({
        stopTargetId: 22,
        personId: 'person-2',
        name: 'Marisol Vega',
        cellPhone: '(615) 555-0177',
      }),
    ])

    expect(
      within(contactCard()).getByRole('link', { name: '(615) 555-0142' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Marisol Vega/ }))

    expect(
      within(contactCard()).getByRole('link', { name: '(615) 555-0177' }),
    ).toBeInTheDocument()
  })
})

// The knock form, the not-a-voter follow-up and the do-not-knock control are
// siblings that all key off the selected target so each resets when the
// canvasser switches resident. Keyed on the bare id they collide, and React
// reconciles same-key siblings as one child — it only says so through a console
// warning, which a passing suite hides.
describe('PersonSheet reconciliation', () => {
  it('keys its three mutating children apart', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(vi.fn())

    // A logged not-a-voter door is the one state where all three render at
    // once, so it is the only one that can surface the collision.
    renderSheet([target({ knockStatus: 'not_a_voter' })])

    expect(warn.mock.calls.flat().join(' ')).not.toMatch(
      /two children with the same key/,
    )
    warn.mockRestore()
  })
})

// ADR 0007 and 0008. A flagged resident reads "Do not knock" in the walk list
// and used to read "Support unknown" here one tap later — two answers to the
// same question about the same person. Both rosters replace the status with the
// marker for the same reason the list does.
describe('PersonSheet flagged residents', () => {
  const household = () =>
    screen.getByRole('heading', { name: 'Household' }).parentElement!

  const switcher = (name: RegExp) => screen.getByRole('button', { name })

  it('replaces the status with the marker in the household roster', () => {
    renderSheet([
      target({ doNotKnock: true }),
      target({
        stopTargetId: 22,
        personId: 'person-2',
        name: 'Marisol Vega',
        notAVoterReason: 'deceased',
      }),
      target({
        stopTargetId: 23,
        personId: 'person-3',
        name: 'Ruben Cole',
        notAVoterReason: 'moved',
      }),
    ])
    const roster = within(household())

    expect(roster.getByText('Do not knock')).toBeInTheDocument()
    expect(roster.getByText('Deceased')).toBeInTheDocument()
    expect(roster.getByText('Moved away')).toBeInTheDocument()
    expect(roster.queryByText('Support unknown')).toBeNull()
  })

  it('replaces the status dot with the marker in the resident switcher', () => {
    renderSheet([
      target(),
      target({
        stopTargetId: 22,
        personId: 'person-2',
        name: 'Marisol Vega',
        notAVoterReason: 'deceased',
      }),
    ])

    expect(switcher(/Marisol Vega/)).toHaveTextContent('Deceased')
    // The knockable resident keeps their dot, so the marker reads as a
    // difference rather than as how everyone is rendered.
    expect(switcher(/Dorian Fen/).querySelector('span.h-2')).toBeTruthy()
    expect(switcher(/Marisol Vega/).querySelector('span.h-2')).toBeNull()
  })

  // A flagged door has nothing to say and nothing to log, so the script and the
  // form go rather than sitting there inert.
  it('withholds the log form behind the reason marker', () => {
    renderSheet([target({ notAVoterReason: 'moved' })])

    expect(screen.queryByTestId('record-knock-form')).toBeNull()
    expect(
      screen.getByText(/no longer lives at this address/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  // Do-not-knock is an instruction about the door; a reason is a fact about one
  // of the people behind it, so the instruction is what gets shown.
  it('shows do-not-knock ahead of a reason when a person carries both', () => {
    renderSheet([target({ doNotKnock: true, notAVoterReason: 'moved' })])

    expect(
      screen.getByText(/asked not to be visited again/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Moved away')).toBeNull()
  })

  // The door is logged by then; the question is a follow-up to it, and the form
  // stays so a mis-tapped outcome is still correctable.
  it('asks for a reason once a door is logged as not a voter', () => {
    renderSheet([target({ knockStatus: 'not_a_voter' })])

    expect(screen.getByText('Not a voter — what happened?')).toBeInTheDocument()
    expect(screen.getByTestId('record-knock-form')).toBeInTheDocument()
  })
})

// ADR 0009.
describe('PersonSheet activity feed', () => {
  const feed = () =>
    screen.getByRole('heading', { name: 'Activity feed' }).parentElement!

  const knock = (
    activityId: string,
    date: string,
    outcome: DoorKnockOutcome = 'answered',
  ): RouteTargetActivity => ({
    type: 'DOOR_KNOCK',
    date,
    data: {
      activityId,
      outcome,
      supportAnswer: null,
      note: null,
      manual: false,
    },
  })

  it('reports an untouched resident rather than leaving the card blank', () => {
    renderSheet([target({ history: [] })])

    expect(
      within(feed()).getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()
  })

  // The feed belongs to the person, not the door. Two people behind one door
  // disagree, and a housemate's refusal attributed to whoever answered is
  // worse than showing nothing at all.
  it('follows the selected resident rather than the household', () => {
    renderSheet([
      target({ history: [knock('dk-1', '2026-08-10T15:00:00.000Z')] }),
      target({
        stopTargetId: 22,
        personId: 'person-2',
        name: 'Marisol Vega',
        history: [
          knock('dk-2', '2026-08-09T15:00:00.000Z', 'refused_to_engage'),
        ],
      }),
    ])

    expect(within(feed()).getByText('Door Knock: Answered')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Marisol Vega/ }))

    const switched = within(feed())
    expect(
      switched.getByText('Door Knock: Refused to Engage'),
    ).toBeInTheDocument()
    expect(switched.queryByText('Door Knock: Answered')).toBeNull()
  })

  // Deliberate, and the opposite of the rule the footer follows. Withholding
  // the form stops a knock; withholding the history would stop someone
  // noticing that the flag was applied to the wrong resident — and the feed is
  // the only surface at the door that carries the flag's own status-change row.
  it('keeps the feed for a flagged resident whose form is withheld', () => {
    renderSheet([
      target({
        doNotKnock: true,
        history: [knock('dk-1', '2026-08-10T15:00:00.000Z')],
      }),
    ])

    expect(screen.queryByTestId('record-knock-form')).toBeNull()
    expect(within(feed()).getByText('Door Knock: Answered')).toBeInTheDocument()
  })

  // A data-quality hint about the file and a canvasser's firsthand report are
  // separate observations that can land on the same person. The hint has no
  // date and no author, so it stays a line in Contact information instead of
  // becoming a second timeline row that reads like the same event logged
  // twice.
  it('leaves mayHaveMoved out of the timeline when both are present', () => {
    renderSheet([
      target({
        mayHaveMoved: true,
        notAVoterReason: 'moved',
        history: [
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
        ],
      }),
    ])

    expect(
      within(contactCard()).getByText(
        'May have moved since this route was built.',
      ),
    ).toBeInTheDocument()
    const timeline = within(feed())
    expect(
      timeline.getByText("Rosa Iyer set Not A Voter to 'Moved away'"),
    ).toBeInTheDocument()
    expect(
      timeline.queryByText('May have moved since this route was built.'),
    ).toBeNull()
  })

  // A route snapshotted by the service worker before this shipped has no
  // history key at all, and it has to render on a phone that cannot refetch.
  it('treats a payload with no history field as an empty feed', () => {
    renderSheet([target()])

    expect(
      within(feed()).getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()
  })
})

// The eleven attributes product asked to surface at the door. Every one is a
// column already in `DOWNLOAD_COLUMNS` — handed to candidates as a CSV today
// behind the same district access check and the same Pro gate — so this card is
// a new surface for existing disclosure rather than new disclosure.
describe('PersonSheet demographic information', () => {
  const demographicCard = () =>
    screen.getByRole('heading', { name: 'Demographic information' })
      .parentElement!

  const fullTarget = (overrides: Partial<RoutePayloadTarget> = {}) =>
    target({
      registeredVoter: true,
      turnoutLikelihood: 'Super',
      maritalStatus: 'Likely Married',
      hasChildrenUnder18: 'Yes',
      veteranStatus: 'Yes',
      homeowner: 'Likely',
      businessOwner: 'Yes',
      levelOfEducation: 'Graduate Degree',
      estimatedIncomeAmount: 82000,
      language: 'Spanish',
      ethnicityGroup: 'Hispanic',
      ...overrides,
    })

  it('shows all eleven attributes for a target', () => {
    renderSheet([fullTarget()])

    const card = within(demographicCard())
    for (const [label, value] of [
      ['Registered voter', 'Yes'],
      ['Turnout likelihood', 'Super'],
      ['Marital status', 'Likely Married'],
      ['Has children under 18', 'Yes'],
      ['Veteran', 'Yes'],
      ['Homeowner', 'Likely'],
      ['Business owner', 'Yes'],
      ['Level of education', 'Graduate Degree'],
      ['Estimated household income', '$75k - $100k'],
      ['Language', 'Spanish'],
      ['Ethnicity', 'Hispanic'],
    ]) {
      const row = card.getByText(label!).parentElement!
      expect(within(row).getByText(value!)).toBeInTheDocument()
    }
  })

  // Not the prototype's "Voter status", which means active-or-inactive
  // registration. This column is turnout propensity, and the prototype's label
  // would name it as something it isn't.
  it('names the turnout column for what it holds', () => {
    renderSheet([fullTarget()])

    const card = within(demographicCard())
    expect(card.getByText('Turnout likelihood')).toBeInTheDocument()
    expect(card.queryByText('Voter status')).toBeNull()
  })

  // Sparseness is the common case in this file, not the edge. The default
  // fixture carries no demographic keys at all, which is also exactly what a
  // route snapshotted offline before this shipped looks like on a phone that
  // cannot refetch.
  it('renders every absent attribute as Not on file', () => {
    renderSheet([target()])

    expect(within(demographicCard()).getAllByText('Not on file')).toHaveLength(
      11,
    )
  })

  // The two presence-only columns hold a value meaning yes or nothing at all,
  // so absence is indistinguishable from unknown. Printing "No" would tell a
  // canvasser at the door that someone is not a veteran on no data at all.
  it.each(['Veteran', 'Business owner'])(
    'says Not on file rather than No for an absent %s',
    (label) => {
      renderSheet([fullTarget({ veteranStatus: null, businessOwner: null })])

      const row = within(demographicCard()).getByText(label).parentElement!
      expect(within(row).getByText('Not on file')).toBeInTheDocument()
      expect(within(row).queryByText('No')).toBeNull()
    },
  )

  // `registeredVoter` is a real boolean off `StateVoterID IS NOT NULL`, so
  // unlike the two above it does have an honest No — and it must still not
  // print one when the key is simply missing.
  it('distinguishes a known No from a missing registration answer', () => {
    renderSheet([fullTarget({ registeredVoter: false })])
    const known =
      within(demographicCard()).getByText('Registered voter').parentElement!
    expect(within(known).getByText('No')).toBeInTheDocument()

    cleanup()

    renderSheet([fullTarget({ registeredVoter: null })])
    const missing =
      within(demographicCard()).getByText('Registered voter').parentElement!
    expect(within(missing).getByText('Not on file')).toBeInTheDocument()
    expect(within(missing).queryByText('No')).toBeNull()
  })

  // A mover has no live row, so the profile describes nobody rather than
  // whoever lives at the address now — the same rule the phone numbers follow.
  it('shows nothing on file for a target who may have moved', () => {
    renderSheet([target({ mayHaveMoved: true })])

    expect(within(demographicCard()).getAllByText('Not on file')).toHaveLength(
      11,
    )
  })

  // Household context is for the conversation, not a second profile: a
  // non-target resident is not someone the candidate asked to contact.
  it('leaves other residents name-only', () => {
    render(
      <PersonSheet
        stop={{
          ...stop([fullTarget()]),
          addresses: [
            {
              addressKey: '105|elm|st',
              address: '105 Elm St',
              targets: [fullTarget()],
              otherResidents: [{ name: 'Ruben Vega' }],
            },
          ],
        }}
        selectedTargetId={21}
        onSelectTarget={vi.fn()}
        statusFor={() => 'unknown'}
        clientKeyFor={() => 'key'}
        onRecorded={vi.fn()}
        onDoNotKnockChanged={vi.fn()}
        onNotAVoterChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const household = within(
      screen.getByRole('heading', { name: 'Household' }).parentElement!,
    )
    expect(household.getByText('Ruben Vega')).toBeInTheDocument()
    expect(household.getByText('Not targeted')).toBeInTheDocument()
    // The neighbor's row carries a name and a status and nothing else — the
    // profile above belongs to the target alone.
    expect(household.queryByText('Likely Married')).toBeNull()
    expect(household.queryByText('Graduate Degree')).toBeNull()
  })
})
