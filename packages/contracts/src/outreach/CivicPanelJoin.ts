// The one way a Serve text asks a constituent onto the official's civic
// panel. A fixed sentence rather than composed copy, because two readers
// depend on its exact words: the composer will not continue without it and
// Improve keeps it word for word, so the ask cannot become something the
// reply reader would not recognize, and gp-api
// marks a send as asking (and so reads JOIN replies off it) only when the
// sentence is in the message it stored.
export const CIVIC_PANEL_JOIN_KEYWORD = 'JOIN'

// The managed invite's ask. Short, and it never names the civic panel: the
// invite body above it already says what joining means (about once a month,
// asked what they think), and the opt-out sits directly under it.
export const CIVIC_PANEL_JOIN_LINE = `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to share your perspectives.`

// Every line a stored send may carry, newest first. Sends written before a
// rewrite carry an older wording (the panel's earlier name among them), so
// the reader and Improve's masking still recognize them; the composer only
// ever writes CIVIC_PANEL_JOIN_LINE. Never drop or edit a legacy line.
export const CIVIC_PANEL_JOIN_LINES = [
  CIVIC_PANEL_JOIN_LINE,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my civic panel. My office will text you about once a month to ask what you think before I decide. Sent with GoodParty.org.`,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my civic panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.`,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my citizens' panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.`,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my citizens' panel, residents my office (not my campaign) texts a few times a year to hear what you think before I make decisions. Empowered by GoodParty.org.`,
] as const

// Why a Serve text other than the managed invite cannot carry a JOIN line.
// gp-api refuses the create with it, and the composer shows it before then.
export const CIVIC_PANEL_JOIN_REFUSED_MESSAGE =
  'Only the invite we send to build your civic panel can ask people to join it. Remove that line and try again.'

// The join line in a message, if it carries one: the last occurrence of any
// recognized wording.
export const findCivicPanelJoinLine = (
  message: string,
): { text: string; start: number } | null => {
  let found: { text: string; start: number } | null = null
  for (const text of CIVIC_PANEL_JOIN_LINES) {
    const start = message.lastIndexOf(text)
    if (start !== -1 && (!found || start > found.start)) found = { text, start }
  }
  return found
}

// The way off the panel that is not STOP. STOP ends every text from the
// office; a member who only wants off the panel replies LEAVE and still gets
// the office's other texts. Carried by a send that goes only to
// panel members (isCivicPanelOnlyList), and never beside the JOIN line. The
// reply ingest honors LEAVE from a member on any Serve send, so this line is
// an offer, not the only door: the words matter to the composer's check and
// to the stamp the create reads off the stored message.
export const CIVIC_PANEL_LEAVE_KEYWORD = 'LEAVE'

export const CIVIC_PANEL_LEAVE_LINE = `Reply ${CIVIC_PANEL_LEAVE_KEYWORD} to leave my civic panel.`

export const findCivicPanelLeaveLine = (
  message: string,
): { text: string; start: number } | null => {
  const start = message.lastIndexOf(CIVIC_PANEL_LEAVE_LINE)
  return start === -1 ? null : { text: CIVIC_PANEL_LEAVE_LINE, start }
}

// How many civic panel lines (JOIN in any wording, or LEAVE) a message
// carries. A send carries at most one: a second is a composer or model echo,
// and gp-api refuses it rather than text people the same ask twice.
export const countCivicPanelLines = (message: string): number =>
  [...CIVIC_PANEL_JOIN_LINES, CIVIC_PANEL_LEAVE_LINE].reduce(
    (count, line) => count + message.split(line).length - 1,
    0,
  )

// A panelist said yes to being asked, so far more of them answer than a cold
// text gets. The panel brief cites 40 to 52 percent on UK council panels; this
// is the low end, until an office's own panel asks give it a measured rate.
export const PANEL_ASSUMED_REPLY_RATE = 0.4

// Nobody contacted by the office in this many days is asked again: the panel
// brief's rotation, so the most eager members are not asked about everything.
export const CONTACT_REST_DAYS = 30

// The share of a cold text to the district that replies JOIN. An assumption
// until offices' own seed sends give it a measured rate.
export const PANEL_SEED_ASSUMED_JOIN_RATE = 0.03
