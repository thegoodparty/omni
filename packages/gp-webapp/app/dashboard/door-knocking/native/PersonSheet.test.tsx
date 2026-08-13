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

const renderSheet = (targets: RoutePayloadTarget[]) =>
  render(
    <PersonSheet
      stop={stop(targets)}
      initialTargetId={targets[0]!.stopTargetId}
      statusFor={(candidate) => candidate.knockStatus}
      clientKeyFor={() => 'key'}
      onRecorded={vi.fn()}
      onDoNotKnockChanged={vi.fn()}
      onClose={vi.fn()}
    />,
  )

const contactCard = () =>
  screen.getByRole('heading', { name: 'Contact information' }).parentElement!

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
