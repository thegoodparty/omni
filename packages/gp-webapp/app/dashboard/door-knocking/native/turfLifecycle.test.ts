import { describe, expect, it } from 'vitest'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { getHistoryStatusLabel } from 'app/dashboard/outreach/v2/historyStatus.util'
import { turfStatusLabel } from './turfLifecycle'

const turf = (fields: Partial<DoorKnockingTurf>): DoorKnockingTurf =>
  ({
    id: 1,
    name: 'Elm St & 5th',
    color: '#22c55e',
    knockedDoorCount: 0,
    completed: false,
    archivedAt: null,
    ...fields,
  }) as DoorKnockingTurf

describe('turfStatusLabel', () => {
  // Four states off two facts. The middle one used to be read from `locked` —
  // route bought, so somebody could be walking it — and there is no such
  // moment any more: a list is born routed, so the only honest way to tell a
  // started walk from an untouched one is whether a door has been knocked.
  it('names each of a saved list four states', () => {
    expect(turfStatusLabel(turf({}))).toBe('Not started')
    expect(turfStatusLabel(turf({ knockedDoorCount: 3 }))).toBe('In progress')
    expect(
      turfStatusLabel(turf({ knockedDoorCount: 3, completed: true })),
    ).toBe('Done')
    expect(
      turfStatusLabel(
        turf({ knockedDoorCount: 3, completed: true, archivedAt: new Date() }),
      ),
    ).toBe('Archived')
  })

  // The report this function was changed for: a domain reviewer opened Details
  // on a list he had drawn and never walked, read "Scheduled", and asked when
  // he had scheduled it. He had not, and could not have — door knocking has no
  // send time and no date picker anywhere in the flow. The canvas's own
  // `renderDkDetails` does say `scheduled` here, so this is a deliberate
  // departure from it and needs a test to stop a future canvas-parity pass
  // putting the word back.
  it('never calls an unwalked list scheduled, whatever else is true of it', () => {
    const unwalked = [turf({}), turf({ archivedAt: new Date() })]
    for (const list of unwalked) {
      expect(turfStatusLabel(list)).not.toBe('Scheduled')
    }
  })

  // The cross-surface claim, as an assertion rather than a comment. One saved
  // list is described by two details drawers — this one, off the door-knocking
  // rail's card, and the outreach history's, off the `Outreach` envelope — and
  // two surfaces disagreeing about one list's status is a worse bug than one
  // confusing word. The envelope is written by the create transaction with
  // `in_progress` and flipped to `completed` when the canvasser ends the
  // session, so those are the only two statuses a walk's row ever carries.
  it('agrees with the history table wherever a walk has an envelope to compare', () => {
    const walking = turf({ knockedDoorCount: 3 })
    expect(turfStatusLabel(walking)).toBe(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'in_progress',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    )

    const finished = turf({ knockedDoorCount: 3, completed: true })
    expect(turfStatusLabel(finished)).toBe(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'completed',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    )
  })

  // The one state where the two surfaces deliberately differ, pinned so it is
  // a decision rather than a surprise. A brand-new list has an envelope from
  // the moment it exists — 3.0 writes the two together — and that envelope
  // opens at `in_progress`, so the history table calls the list "In progress"
  // while this rail still calls it "Not started". The rail is the more precise
  // of the two because it can see the door count; the envelope has no state
  // between born and finished, and inventing one would mean a fourth
  // `OutreachStatus` for one channel's benefit.
  it('is more precise than the envelope on a list nobody has walked', () => {
    expect(turfStatusLabel(turf({}))).toBe('Not started')
    expect(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'in_progress',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    ).toBe('In progress')
  })

  // "Not started" stays this rail's alone: were a `nativeDoorKnocking` row
  // ever to arrive in some other state, the non-p2p map would render it "In
  // review", so the label cannot leak into a sending channel's vocabulary.
  it('is a word only the door-knocking rail can produce', () => {
    expect(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'pending',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    ).not.toBe('Not started')
  })
})
