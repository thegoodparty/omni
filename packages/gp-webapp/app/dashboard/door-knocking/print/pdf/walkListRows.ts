import type { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import { skipInstruction, STATUS_LABELS } from '../../native/statusPresentation'
import { describeTarget, lastContactLine, legTravelLine } from '../walkFacts'

// What the three answer columns hold for one resident. `skip` and `logged`
// replace the tick-boxes entirely — there is nothing to ask at either door.
//
// `skip` carries its own wording because the three reasons to skip are not the
// same instruction: don't knock this door, this person moved away, this person
// died. The renderers print what the model decided rather than deriving it
// again, which is what keeps the printable page and the PDF saying the same
// thing.
export type WalkListAnswer =
  | { kind: 'form' }
  | { kind: 'logged'; label: string }
  | { kind: 'skip'; instruction: string }

export interface WalkListRow {
  key: string
  seq: number
  address: string
  // Household context, name-only, shown once under the address. Not a row of
  // its own: a row is someone the candidate asked to contact, and printing a
  // form beside a non-target's name would invite a knock nobody requested.
  otherResidents: string[]
  name: string
  // A column of its own since the design handoff, so it is no longer part of
  // `meta`. Null prints an empty cell rather than a dash: a missing age is a gap
  // in the voter file, and a canvasser reads anything in that cell as a fact
  // about the person.
  age: number | null
  meta: string
  // ENG-10876. When this campaign last reached this resident and what happened,
  // or null when it never has. A blank answer form means "worth knocking", which
  // on paper reads the same for a door nobody has been to and one that answered
  // unsure — this is the line that tells them apart. Never a note and never a
  // phone number; see `lastContactLine`.
  lastContact: string | null
  // How long the walk from the previous stop takes, on the stop's first row and
  // null on every other row of it — the same merge as the stop number, because
  // it is the same kind of fact. Null on the first stop of a route, which has no
  // previous stop to have come from. Worded by `legTravelLine` rather than here,
  // so the PDF and the printable sheet cannot describe one leg two ways.
  travel: string | null
  answer: WalkListAnswer
  // The grid merges the stop-number cell down a stop and the address cell down
  // a household, so a block of flats reads as one stop and a shared front door
  // as one door. The renderer draws the merge by omitting the cell's top rule
  // on every row but the first.
  firstInStop: boolean
  firstInHousehold: boolean
}

// One row per targeted resident, in walk order. The payload isn't guaranteed to
// arrive in seq order and paper is walked in it.
export const walkListRows = (
  stops: DoorKnockingRoutePayload['stops'],
): WalkListRow[] => {
  const ordered = stops.slice().sort((a, b) => a.seq - b.seq)

  return ordered.flatMap((stop) => {
    let firstInStop = true

    return stop.addresses.flatMap((address) => {
      let firstInHousehold = true

      return address.targets.map((target) => {
        const skip = skipInstruction(target)
        const row: WalkListRow = {
          key: String(target.stopTargetId),
          seq: stop.seq,
          address: address.address,
          otherResidents: address.otherResidents
            .map((resident) => resident.name)
            .filter((name): name is string => Boolean(name)),
          name: target.name ?? 'Name unavailable',
          age: target.age,
          meta: describeTarget(target),
          lastContact: lastContactLine(target),
          travel: firstInStop ? legTravelLine(stop) : null,
          // Checked before the logged branch: a flagged resident is not to be
          // knocked whatever was recorded there before.
          answer: skip
            ? { kind: 'skip', instruction: skip }
            : target.knockStatus === 'unknown'
              ? { kind: 'form' }
              : { kind: 'logged', label: STATUS_LABELS[target.knockStatus] },
          firstInStop,
          firstInHousehold,
        }
        firstInStop = false
        firstInHousehold = false
        return row
      })
    })
  })
}

// A list called "Elm & Cedar — Tuesday" saves as `elm-cedar-tuesday.pdf`. A
// name made entirely of punctuation slugifies to nothing, which would leave a
// file called `.pdf`, so it falls back instead.
export const walkListFilename = (turfName: string): string => {
  const slug = turfName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')

  return slug ? `${slug}.pdf` : 'walk-list.pdf'
}
