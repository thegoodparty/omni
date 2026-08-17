import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { RoutePayloadStop, RoutePayloadTarget } from '@goodparty_org/contracts'
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
  knockStatus: 'unknown',
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
