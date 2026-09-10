// The five-section door-knocking card, and the line between what is frozen
// with a list and what is composed for whoever is reading it.
//
// Source: Door Knocking Script.docx (product), and
// docs/features/door-knocking-talking-points.md for why the split falls here.
//
//   1a Introduction — identity      composed at render (buildIntro et al.)
//   1b Introduction — question      STORED, generated
//   2  Context                      STORED, generated
//   3  Call to action               STORED, composed at create, editable
//   4  Ask                          STORED, generated
//   5  Departure / thanks           composed at render (the constant below)
//
// The two composed sections depend on WHO IS READING the card, not on which
// list it is, so they cannot be frozen at create time by a candidate on a
// laptop and then read by a volunteer on a doorstep. Everything stored is
// list-specific and candidate-editable.

// The stored artifact: four lines, in card order, newline-separated on
// `Outreach.script` — the column every other outreach channel already keeps
// its script in.
//
// Plain text rather than JSON because that column is `String? @db.Text` and
// shared with four channels that store prose in it. Nothing may contain the
// delimiter, so it is taken back out on the way in: the draft endpoint
// collapses what the model writes (`asSingleLine`) and `serializeTalkingPoints`
// collapses what the CANDIDATE writes, which is the path that can really
// produce one — the step's four boxes are textareas, and a pasted paragraph
// or a stray Return would otherwise write a five-line card that
// `parseTalkingPoints` has to reject whole, silently, at every door.
export interface TalkingPointsLines {
  engagementQuestion: string
  context: string
  cta: string
  ask: string
}

const LINE_ORDER = ['engagementQuestion', 'context', 'cta', 'ask'] as const

// One section, on one line. The same collapse the draft endpoint applies to a
// generated line, applied here to an edited one.
const asSingleLine = (line: string): string => line.replace(/\s+/g, ' ').trim()

export const serializeTalkingPoints = (lines: TalkingPointsLines): string =>
  LINE_ORDER.map((key) => asSingleLine(lines[key])).join('\n')

// Null for anything that is not four lines, which is the honest answer for a
// list created before this shipped (no stored points at all) and for a row
// written by some future shape. Callers fall back to the static script rather
// than rendering a half-parsed card.
//
// An empty line is allowed and kept: a campaign with no website on file has no
// call to action to name, and that is a blank section rather than a bad row.
export const parseTalkingPoints = (
  stored: string | null | undefined,
): TalkingPointsLines | null => {
  if (!stored) return null
  const parts = stored.split('\n')
  if (parts.length !== LINE_ORDER.length) return null
  // Every section blank is an empty card, not a card.
  if (!parts.some((part) => part.trim().length > 0)) return null
  return {
    engagementQuestion: parts[0] ?? '',
    context: parts[1] ?? '',
    cta: parts[2] ?? '',
    ask: parts[3] ?? '',
  }
}

// Section 3. Composed rather than generated because the URL is real data a
// model asked to phrase this could equally well invent — the prompt bans links
// outright for that reason.
//
// Register is close to literal, unlike the generated notes around it: a
// canvasser cannot paraphrase a web address.
export const composeCta = (website: string | null | undefined): string => {
  const url = (website ?? '').trim().replace(/^https?:\/\//i, '')
  if (!url) return ''
  return `Point them to ${url} to learn more — no commitment needed.`
}

// Section 5. The template says this one is constant regardless of how the
// conversation went, so it is a constant.
//
// Written in the note register the generated lines use, not as a line to
// recite: thank them, say the support matters, leave the channel open.
export const DEPARTURE_NOTE =
  'Thank them for their time, tell them it genuinely helps, and leave the ' +
  'door open to get in touch.'

// The card as read at a door: the composed identity clause, then the stored
// lines in order, then the constant close. Blank sections drop out rather than
// printing an empty bullet.
export const composeTalkingPointsCard = (
  intro: string,
  lines: TalkingPointsLines,
): string[] =>
  [intro, lines.engagementQuestion, lines.context, lines.cta, lines.ask]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .concat(DEPARTURE_NOTE)
