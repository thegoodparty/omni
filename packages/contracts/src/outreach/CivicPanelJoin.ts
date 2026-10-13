import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'

// The one way a Serve text asks a constituent onto the official's citizens'
// panel. A fixed sentence rather than composed copy, because two readers
// depend on its exact words: the composer locks it so the ask cannot be
// edited into something the reply reader would not recognize, and gp-api
// marks a send as asking (and so reads JOIN replies off it) only when the
// sentence is in the message it stored.
export const CIVIC_PANEL_JOIN_KEYWORD = 'JOIN'

// Says what joining means in the constituent's terms: who is asking (the
// office, never a campaign) and how often. Two sentences at most: it shares a
// text with the official's own message, and the opt-out line below it already
// says how to leave.
export const CIVIC_PANEL_JOIN_LINE = `Reply ${CIVIC_PANEL_JOIN_KEYWORD} to join my citizens' panel, residents my office (not my campaign) texts a few times a year to hear what you think before I make decisions. Empowered by GoodParty.org.`

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
