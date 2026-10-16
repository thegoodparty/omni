import { describe, expect, it } from 'vitest'
import {
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_LEAVE_LINE,
  findCivicPanelLeaveLine,
  CIVIC_PANEL_JOIN_LINES,
  countCivicPanelLines,
  findCivicPanelJoinLine,
} from './CivicPanelJoin'

// Written out rather than read from CIVIC_PANEL_JOIN_LINES: sends already
// stored carry these exact words, so editing or dropping one must fail here.
const LEGACY_JOIN_LINES = [
  "Reply JOIN to join my citizens' panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.",
  "Reply JOIN to join my citizens' panel, residents my office (not my campaign) texts a few times a year to hear what you think before I make decisions. Empowered by GoodParty.org.",
]

describe('CIVIC_PANEL_JOIN_LINE', () => {
  it('composes the civic panel wording', () => {
    expect(CIVIC_PANEL_JOIN_LINE).toBe(
      'Reply JOIN to join my civic panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.',
    )
    expect(CIVIC_PANEL_JOIN_LINES[0]).toBe(CIVIC_PANEL_JOIN_LINE)
  })

  it.each(LEGACY_JOIN_LINES)(
    'still reads a send carrying an earlier wording as asking: %s',
    (legacy) => {
      expect(CIVIC_PANEL_JOIN_LINES).toContain(legacy)
      const message = `Hi Pat, what do you think about the park?\n\n${legacy}\n\nReply STOP to opt out`
      expect(findCivicPanelJoinLine(message)).toEqual({
        text: legacy,
        start: message.indexOf(legacy),
      })
    },
  )

  it('composes only the newest wording', () => {
    expect(LEGACY_JOIN_LINES).not.toContain(CIVIC_PANEL_JOIN_LINE)
    expect(CIVIC_PANEL_JOIN_LINES).toHaveLength(LEGACY_JOIN_LINES.length + 1)
  })
})

describe('CIVIC_PANEL_LEAVE_LINE', () => {
  it('is the panel-only way off the panel', () => {
    expect(CIVIC_PANEL_LEAVE_LINE).toBe('Reply LEAVE to leave my civic panel.')
  })

  it('is found where a send carries it, and never read as a join', () => {
    const message = `Hi Pat, what do you think about the park?\n\n${CIVIC_PANEL_LEAVE_LINE}\n\nReply STOP to opt out.`
    expect(findCivicPanelLeaveLine(message)).toEqual({
      text: CIVIC_PANEL_LEAVE_LINE,
      start: message.indexOf(CIVIC_PANEL_LEAVE_LINE),
    })
    expect(findCivicPanelJoinLine(message)).toBeNull()
    expect(findCivicPanelLeaveLine('Reply STOP to opt out.')).toBeNull()
  })
})

describe('countCivicPanelLines', () => {
  it('counts every JOIN wording and the LEAVE line', () => {
    expect(countCivicPanelLines('Hello. Reply STOP to opt out.')).toBe(0)
    expect(countCivicPanelLines(`Hi.\n\n${CIVIC_PANEL_JOIN_LINE}`)).toBe(1)
    expect(
      countCivicPanelLines(
        `${CIVIC_PANEL_JOIN_LINE}\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
      ),
    ).toBe(2)
    expect(
      countCivicPanelLines(
        `${CIVIC_PANEL_JOIN_LINES[1]} ${CIVIC_PANEL_LEAVE_LINE}`,
      ),
    ).toBe(2)
  })
})
