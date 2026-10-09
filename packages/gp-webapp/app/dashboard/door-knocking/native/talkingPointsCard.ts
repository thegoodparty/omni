import { DOOR_KNOCKING_BULLET } from '@goodparty_org/contracts'

// The door-knocking card a list stores, as the walk reads it.
//
// Source: Door Knocking Script.docx (product), and
// docs/features/door-knocking-talking-points.md.
//
// A stored card is shown exactly as written, with nothing composed around it.
// A free-text card carries its own opening and close as notes, and a card
// frozen before free text (four plain lines) reads as four sentences. Both
// shapes go through the one rule below, so nothing has to tell them apart.

// One line of the card as read at a door. A bullet is a line the candidate (or
// the draft) started with the bullet marker; anything else is a sentence they
// wrote and is shown as written.
export interface TalkingPoint {
  text: string
  bullet: boolean
}

const BULLET_MARKER = DOOR_KNOCKING_BULLET.trim()

// The stored card's lines. Null for a list with nothing stored, so the caller
// falls back to the composed introduction and the candidate's issue stances.
export const readTalkingPoints = (
  stored: string | null | undefined,
): TalkingPoint[] | null => {
  if (!stored) return null

  const points = stored
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line.startsWith(BULLET_MARKER)
        ? { text: line.slice(BULLET_MARKER.length).trim(), bullet: true }
        : { text: line, bullet: false },
    )
    // A marker with nothing after it is an empty bullet, not a line.
    .filter((point) => point.text.length > 0)

  return points.length > 0 ? points : null
}
