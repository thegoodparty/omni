import { CIVIC_PANEL_JOIN_KEYWORD } from '@goodparty_org/contracts'

// The one definition of "this reply joins the civic panel", read only off a
// send that asked (Outreach.asksToJoinCivicPanel). Shaped like the opt-out
// predicate beside it, and stricter in the same direction: enrolling someone
// who did not say yes puts them on every panel ask after this one, so the
// keyword counts only as the whole reply or a sentence of its own. "I'd like
// to join the meeting" is a reply about a meeting, not a yes to the panel.

const SEGMENT_BOUNDARY = /[.!?;\n\r]+/

const KEYWORD = CIVIC_PANEL_JOIN_KEYWORD.toLowerCase()

// "join please", "yes join", "JOIN!" all read as the keyword; anything longer
// is a sentence that happens to contain the word.
const ACCEPTED = new Set([
  KEYWORD,
  `${KEYWORD} please`,
  `please ${KEYWORD}`,
  `yes ${KEYWORD}`,
  `${KEYWORD} me`,
])

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const isCivicPanelJoinMessage = (
  content: string | null | undefined,
): boolean => {
  if (!content) return false
  if (ACCEPTED.has(normalize(content))) return true
  return content
    .split(SEGMENT_BOUNDARY)
    .some((segment) => ACCEPTED.has(normalize(segment)))
}
