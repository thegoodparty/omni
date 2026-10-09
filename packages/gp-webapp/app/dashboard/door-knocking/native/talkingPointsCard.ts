import { DOOR_KNOCKING_BULLET } from '@goodparty_org/contracts'

// The door-knocking card, and the line between what is frozen with a list and
// what is composed for whoever is reading it.
//
// Source: Door Knocking Script.docx (product), and
// docs/features/door-knocking-talking-points.md for why the split falls here.
//
//   Introduction      composed at render (buildIntro et al.)
//   Talking points    STORED, AI-drafted bullets the candidate may reshape
//   Departure/thanks  composed at render (the constant below)
//
// The two composed parts depend on WHO IS READING the card, not on which list
// it is, so they cannot be frozen at create time by a candidate on a laptop
// and then read by a volunteer on a doorstep. Everything stored is
// list-specific and candidate-editable.

// One line of the card as read at a door. A bullet is a line the candidate (or
// the draft) started with the bullet marker; anything else is a sentence they
// wrote and is shown as written.
export interface TalkingPoint {
  text: string
  bullet: boolean
}

// The template says the close is constant regardless of how the conversation
// went, so it is a constant.
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

// The stored card as the walk reads it, closed with DEPARTURE_NOTE as a
// bullet. Null for a list with nothing stored, so the caller falls back to the
// candidate's issue stances.
//
// Accepted edge: new free text that happens to be exactly four plain lines,
// none of them bulleted, is indistinguishable from a legacy row and is read as
// one, so its sentences show as bullets. The words are the same either way.
export const readTalkingPoints = (
  stored: string | null | undefined,
): TalkingPoint[] | null => {
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

  return [...points, { text: DEPARTURE_NOTE, bullet: true }]
}
