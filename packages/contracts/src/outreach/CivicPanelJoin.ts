import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'

// The one way a Serve text asks a constituent onto the official's civic
// panel. A fixed sentence rather than composed copy, because two readers
// depend on its exact words: the composer locks it so the ask cannot be
// edited into something the reply reader would not recognize, and gp-api
// marks a send as asking (and so reads JOIN replies off it) only when the
// sentence is in the message it stored.
export const CIVIC_PANEL_JOIN_KEYWORD = 'JOIN'

// Says what joining means in the constituent's terms: who is asking (the
// office) and how often. Short: it shares a text with the official's own
// message, and the opt-out line below it already says how to leave.
export const CIVIC_PANEL_JOIN_LINE = `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my civic panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.`

// Every line a stored send may carry, newest first. Sends written before a
// rewrite carry an older wording (the panel's earlier name among them), so
// the reader and the composer's lock still recognize them; the composer only
// ever writes CIVIC_PANEL_JOIN_LINE. Never drop or edit a legacy line.
export const CIVIC_PANEL_JOIN_LINES = [
  CIVIC_PANEL_JOIN_LINE,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my citizens' panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.`,
  `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my citizens' panel, residents my office (not my campaign) texts a few times a year to hear what you think before I make decisions. Empowered by GoodParty.org.`,
] as const

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
// the office's other texts. Carried, locked, by a send that goes only to
// panel members (isCivicPanelOnlyList), and never beside the JOIN line. The
// reply ingest honors LEAVE from a member on any Serve send, so this line is
// an offer, not the only door: the words matter to the composer's lock and
// to the stamp the create reads off the stored message.
export const CIVIC_PANEL_LEAVE_KEYWORD = 'LEAVE'

export const CIVIC_PANEL_LEAVE_LINE = `Reply ${CIVIC_PANEL_LEAVE_KEYWORD} to leave my civic panel.`

export const findCivicPanelLeaveLine = (
  message: string,
): { text: string; start: number } | null => {
  const start = message.lastIndexOf(CIVIC_PANEL_LEAVE_LINE)
  return start === -1 ? null : { text: CIVIC_PANEL_LEAVE_LINE, start }
}

// A panelist said yes to being asked, so far more of them answer than a cold
// text gets. The panel brief cites 40 to 52 percent on UK council panels; this
// is the low end, until an office's own panel asks give it a measured rate.
export const PANEL_ASSUMED_REPLY_RATE = 0.4

// Nobody contacted by the office in this many days is asked again: the panel
// brief's rotation, so the most eager members are not asked about everything.
export const CONTACT_REST_DAYS = 30

// The panel an office starts with: enough members for a read on a priority.
export const PANEL_SEED_TARGET_MEMBERS = 100

// The share of a cold text to the district that replies JOIN. An assumption
// until offices' own seed sends give it a measured rate.
export const PANEL_SEED_ASSUMED_JOIN_RATE = 0.03

// How many residents the first panel text goes to, drawn at random from the
// district's cell phones: 3,334, under the sampler's ceiling. A district
// with fewer cell phones than this is texted whole.
export const PANEL_SEED_SAMPLE_SIZE = Math.min(
  Math.ceil(PANEL_SEED_TARGET_MEMBERS / PANEL_SEED_ASSUMED_JOIN_RATE),
  MAX_LIST_SAMPLE_SIZE,
)

// The hidden turn the Chief of Staff home sends when the official presses Get
// started on the build card, so the agent starts building the panel and the
// transcript can leave the turn out. A fixed string: the chat hides it on
// reload by its exact words, and gp-api titles the conversation off it.
export const BUILD_CITIZENS_PANEL_MARKER = '[Build civic panel]'
export const BUILD_CITIZENS_PANEL_MESSAGE = `${BUILD_CITIZENS_PANEL_MARKER} Help me build my civic panel.`
