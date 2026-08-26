import { describe, expect, it } from 'vitest'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { getHistoryStatusLabel } from 'app/dashboard/outreach/v2/historyStatus.util'
import { turfStatusLabel } from './turfLifecycle'

const turf = (fields: Partial<DoorKnockingTurf>): DoorKnockingTurf =>
  ({
    id: 1,
    name: 'Elm St & 5th',
    color: '#22c55e',
    locked: false,
    completedAt: null,
    archivedAt: null,
    ...fields,
  }) as DoorKnockingTurf

describe('turfStatusLabel', () => {
  it('names each of a saved list four states', () => {
    expect(turfStatusLabel(turf({ locked: false }))).toBe('Not started')
    expect(turfStatusLabel(turf({ locked: true }))).toBe('In progress')
    expect(
      turfStatusLabel(turf({ locked: true, completedAt: new Date() })),
    ).toBe('Done')
    expect(
      turfStatusLabel(
        turf({ locked: true, completedAt: new Date(), archivedAt: new Date() }),
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
    const unlocked = [
      turf({ locked: false }),
      turf({ locked: false, archivedAt: new Date() }),
    ]
    for (const list of unlocked) {
      expect(turfStatusLabel(list)).not.toBe('Scheduled')
    }
  })

  // The cross-surface claim, as an assertion rather than a comment. One saved
  // list is described by two details drawers — this one, off the door-knocking
  // rail's card, and the outreach history's, off the `Outreach` envelope — and
  // two surfaces disagreeing about one list's status is a worse bug than one
  // confusing word. The envelope is written by the knock transaction with
  // `in_progress` and flipped to `completed` when the canvasser ends the
  // session, so those are the only two statuses a walk's row ever carries.
  it('agrees with the history table wherever a walk has an envelope to compare', () => {
    const walked = turf({ locked: true })
    expect(turfStatusLabel(walked)).toBe(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'in_progress',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    )

    const finished = turf({ locked: true, completedAt: new Date() })
    expect(turfStatusLabel(finished)).toBe(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'completed',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    )
  })

  // The state with no envelope to disagree with, which is why relabelling it
  // was safe: `doorKnockingKnock.service.ts` creates the row inside the knock
  // transaction, so a list nobody has walked is in no outreach history at all.
  // If a `nativeDoorKnocking` row ever did arrive un-walked, the non-p2p map
  // would render it "In review", never "Not started" — so this label stays
  // this drawer's alone and cannot leak into a sending channel's vocabulary.
  it('is a word only the door-knocking rail can produce', () => {
    expect(
      getHistoryStatusLabel({
        outreachType: 'nativeDoorKnocking',
        status: 'pending',
      } as Parameters<typeof getHistoryStatusLabel>[0]),
    ).not.toBe('Not started')
  })
})
