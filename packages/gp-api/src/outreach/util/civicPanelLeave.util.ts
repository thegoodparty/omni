import { CIVIC_PANEL_LEAVE_KEYWORD } from '@goodparty_org/contracts'

// The one definition of "this reply leaves the civic panel", the twin of
// civicPanelJoin.util.ts and as strict, for the mirror reason: taking someone
// off who did not ask drops them from every panel ask after this one. The
// keyword counts only as the whole reply or a sentence of its own, so "I
// had to leave the meeting early" is a reply about a meeting. It is never an
// opt-out: STOP stays the only way to end the office's texts.

const SEGMENT_BOUNDARY = /[.!?;\n\r]+/

const KEYWORD = CIVIC_PANEL_LEAVE_KEYWORD.toLowerCase()

const ACCEPTED = new Set([
  KEYWORD,
  `${KEYWORD} please`,
  `please ${KEYWORD}`,
  `yes ${KEYWORD}`,
  `${KEYWORD} panel`,
  `${KEYWORD} the panel`,
  `${KEYWORD} civic panel`,
  `${KEYWORD} the civic panel`,
])

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const isCivicPanelLeaveMessage = (
  content: string | null | undefined,
): boolean => {
  if (!content) return false
  if (ACCEPTED.has(normalize(content))) return true
  return content
    .split(SEGMENT_BOUNDARY)
    .some((segment) => ACCEPTED.has(normalize(segment)))
}
