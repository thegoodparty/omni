import { DOOR_KNOCKING_BULLET } from '@goodparty_org/contracts'

// The door-knocking card, and the line between what is frozen with a list and
// what is composed for whoever is reading it.
//
// Source: Door Knocking Script.docx (product), and
// docs/features/door-knocking-talking-points.md for why the split falls here.
//
// A list saved with free text stores the whole card: the opening and the close
// are bullets like any other, written as notes in the third person so they
// read the same for the candidate and a volunteer. The walk shows exactly
// those lines.
//
// A list frozen before free text stored only the middle, so the walk still
// frames it with the composed introduction (buildIntro et al.) and the
// departure note below.

// One line of the card as read at a door. A bullet is a line the candidate (or
// the draft) started with the bullet marker; anything else is a sentence they
// wrote and is shown as written.
export interface TalkingPoint {
  text: string
  bullet: boolean
}

// The close a legacy card is framed with, constant however the conversation
// went.
//
// Written in the note register the drafted lines use, not as a line to recite:
// thank them, say the support matters, leave the channel open.
export const DEPARTURE_NOTE =
  'Thank them for their time, tell them it genuinely helps, and leave the ' +
  'door open to get in touch.'

const BULLET_MARKER = DOOR_KNOCKING_BULLET.trim()

// A list frozen before free text stored exactly four plain lines: question,
// context, call to action (blank with no website on file), ask. Those rows are
// not migrated, so the walk keeps reading them the way it always has.
const LEGACY_LINE_COUNT = 4

export interface StoredTalkingPoints {
  points: TalkingPoint[]
  // A card from before free text, which the walk frames with the composed
  // introduction and closes with DEPARTURE_NOTE.
  legacy: boolean
}

// The stored card as the walk reads it. Null for a list with nothing stored,
// so the caller falls back to the candidate's issue stances.
//
// Accepted edge: new free text that happens to be exactly four plain lines,
// none of them bulleted, is indistinguishable from a legacy row and is read as
// one, so its sentences show as bullets inside the composed frame.
export const readTalkingPoints = (
  stored: string | null | undefined,
): StoredTalkingPoints | null => {
  if (!stored) return null
  const lines = stored.split(/\r?\n/).map((line) => line.trim())
  const nonBlank = lines.filter((line) => line.length > 0)
  if (nonBlank.length === 0) return null

  const isLegacy =
    lines.length === LEGACY_LINE_COUNT &&
    !lines.some((line) => line.startsWith(BULLET_MARKER))

  const points = isLegacy
    ? nonBlank.map((text) => ({ text, bullet: true }))
    : nonBlank
        .map((line) =>
          line.startsWith(BULLET_MARKER)
            ? { text: line.slice(BULLET_MARKER.length).trim(), bullet: true }
            : { text: line, bullet: false },
        )
        // A marker with nothing after it is an empty bullet, not a line.
        .filter((point) => point.text.length > 0)
  if (points.length === 0) return null

  return isLegacy
    ? {
        points: [...points, { text: DEPARTURE_NOTE, bullet: true }],
        legacy: true,
      }
    : { points, legacy: false }
}
