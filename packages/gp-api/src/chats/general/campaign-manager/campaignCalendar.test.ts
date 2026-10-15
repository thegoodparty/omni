import { parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import {
  buildCalendarBlock,
  CALENDAR_RULE,
  hasCalendarDate,
  type CalendarInput,
} from './campaignCalendar'

// Melecia's worked example: a Little Rock candidate on Monday, October 12,
// 2026, a week before early voting opens on Monday the 19th.
const TODAY = parseISO('2026-10-12')

const earlyVoting = (start: string | null, end: string | null) => ({
  heading: 'EARLY VOTING',
  name: 'early voting',
  source: 'BallotReady' as const,
  start,
  end,
})

const build = (over: Partial<CalendarInput> = {}): string | null =>
  buildCalendarBlock({ today: TODAY, dates: [], windows: [], ...over })

describe('buildCalendarBlock', () => {
  it('renders nothing when no date or window is on file', () => {
    expect(build()).toBeNull()
    expect(build({ windows: [earlyVoting(null, null)] })).toBeNull()
  })

  it('opens with the rule that dates and statuses are taken, not derived', () => {
    const block = build({ windows: [earlyVoting('2026-10-19', '2026-11-02')] })
    expect(block).toContain("CALENDAR (as of the candidate's local day)\n")
    expect(block).toContain(CALENDAR_RULE)
  })

  describe('windows', () => {
    it('is NOT YET OPEN before the start, with the opening date as the sentence', () => {
      const block = build({
        windows: [earlyVoting('2026-10-19', '2026-11-02')],
      })
      expect(block).toContain(
        'EARLY VOTING (BallotReady)\n' +
          'Opens: Monday, October 19, 2026\n' +
          'Closes: Monday, November 2, 2026\n' +
          'Status: NOT YET OPEN\n' +
          'Days until it opens: 7\n' +
          'Approved description: "Early voting opens October 19."\n' +
          'Do not describe early voting as currently open.',
      )
    })

    it('is OPEN between the boundaries, inclusive of both days', () => {
      for (const today of ['2026-10-19', '2026-10-25', '2026-11-02']) {
        const block = buildCalendarBlock({
          today: parseISO(today),
          dates: [],
          windows: [earlyVoting('2026-10-19', '2026-11-02')],
        })
        expect(block, today).toContain('Status: OPEN\nDays until it closes: ')
        expect(block, today).toContain(
          'Approved description: "Early voting is open through November 2."\n' +
            'Do not describe early voting as not yet open or as over.',
        )
      }
    })

    it('is CLOSED after the end', () => {
      const block = buildCalendarBlock({
        today: parseISO('2026-11-03'),
        dates: [],
        windows: [earlyVoting('2026-10-19', '2026-11-02')],
      })
      expect(block).toContain(
        'Status: CLOSED\n' +
          'Days since it closed: 1\n' +
          'Approved description: "Early voting closed November 2."\n' +
          'Do not describe early voting as open.',
      )
    })

    it('never calls a window open from one boundary', () => {
      const endOnlyAhead = build({
        windows: [earlyVoting(null, '2026-11-02')],
      })
      expect(endOnlyAhead).toContain(
        'Opens: not on file\n' +
          'Closes: Monday, November 2, 2026\n' +
          'Status: UNKNOWN\n' +
          'Reason: opening_date_unknown\n' +
          'Days until it closes: 21\n' +
          'Approved description: "Early voting closes November 2."\n' +
          'Do not describe early voting as open; only its closing date is on file.',
      )
      const startOnlyPast = build({
        windows: [earlyVoting('2026-10-01', null)],
      })
      expect(startOnlyPast).toContain(
        'Status: UNKNOWN\n' +
          'Reason: closing_date_unknown\n' +
          'Days since it opened: 11\n' +
          'Approved description: "Early voting opened October 1."\n' +
          'Do not describe early voting as open; only its opening date is on file.',
      )
      // On the boundary day itself, one side still settles nothing.
      expect(build({ windows: [earlyVoting('2026-10-12', null)] })).toContain(
        'Status: UNKNOWN\nReason: closing_date_unknown\nDays since it opened: 0',
      )
      expect(build({ windows: [earlyVoting(null, '2026-10-12')] })).toContain(
        'Status: UNKNOWN\nReason: opening_date_unknown\nDays until it closes: 0',
      )
    })

    it('settles nothing from a window whose end precedes its start', () => {
      const block = build({
        windows: [earlyVoting('2026-10-20', '2026-10-01')],
      })
      expect(block).toContain(
        'Status: UNKNOWN\n' +
          'Reason: boundaries_out_of_order\n' +
          'Approved description: "Confirm the early voting dates before planning around them."',
      )
      expect(block).not.toContain('NOT YET OPEN')
    })

    it('still settles what one boundary can: not yet open before a start, closed after an end', () => {
      expect(build({ windows: [earlyVoting('2026-10-19', null)] })).toContain(
        'Status: NOT YET OPEN',
      )
      expect(build({ windows: [earlyVoting(null, '2026-10-02')] })).toContain(
        'Status: CLOSED\n' +
          'Days since it closed: 10\n' +
          'Approved description: "Early voting closed October 2."',
      )
    })

    it('uses plural verbs for a plural window', () => {
      const block = build({
        windows: [
          {
            heading: 'MAIL BALLOT REQUESTS',
            name: 'mail ballot requests',
            plural: true,
            source: 'BallotReady',
            start: null,
            end: '2026-10-24',
          },
        ],
      })
      expect(block).toContain(
        'Approved description: "Mail ballot requests close October 24."\n' +
          'Do not describe mail ballot requests as open; only their closing date is on file.',
      )
      const both = (start: string, end: string) =>
        build({
          windows: [
            {
              heading: 'MAIL BALLOT REQUESTS',
              name: 'mail ballot requests',
              plural: true,
              source: 'BallotReady',
              start,
              end,
            },
          ],
        })
      expect(both('2026-10-19', '2026-10-24')).toContain(
        'Approved description: "Mail ballot requests open October 19."',
      )
      expect(both('2026-10-05', '2026-10-24')).toContain(
        'Approved description: "Mail ballot requests are open through October 24."\n' +
          'Do not describe mail ballot requests as not yet open or as over.',
      )
    })

    it('reports which windows carry a usable date', () => {
      expect(hasCalendarDate('2026-10-19', null)).toBe(true)
      expect(hasCalendarDate(null, '2026-10-19')).toBe(true)
      expect(hasCalendarDate(null, null)).toBe(false)
      expect(hasCalendarDate('2026-13-45', null)).toBe(false)
    })

    it('tags a record window with its source', () => {
      const block = build({
        windows: [
          {
            heading: 'FILING PERIOD',
            name: 'filing',
            source: 'campaign record',
            start: '2026-11-16',
            end: '2026-11-23',
          },
        ],
      })
      expect(block).toContain('FILING PERIOD (campaign record)\n')
      expect(block).toContain(
        'Approved description: "Filing opens November 16."',
      )
    })
  })

  describe('single days', () => {
    const election = (record: string | null, live: string | null) => ({
      heading: 'ELECTION DAY',
      name: 'Election Day',
      record,
      live,
    })

    it('is UPCOMING with the days remaining on their own line', () => {
      const block = build({ dates: [election('2026-11-03', '2026-11-03')] })
      expect(block).toContain(
        'ELECTION DAY (election data)\n' +
          'Tuesday, November 3, 2026\n' +
          'Status: UPCOMING\n' +
          'Days remaining: 22\n' +
          'Approved description: "Election Day is Tuesday, November 3."\n' +
          'Do not describe Election Day as past.',
      )
    })

    it('is TODAY on the day, with no count and no caution', () => {
      const block = buildCalendarBlock({
        today: parseISO('2026-11-03'),
        dates: [election('2026-11-03', null)],
        windows: [],
      })
      expect(block).toContain(
        'ELECTION DAY (campaign record)\n' +
          'Tuesday, November 3, 2026\n' +
          'Status: TODAY\n' +
          'Approved description: "Election Day is today, Tuesday, November 3."',
      )
      expect(block).not.toContain('Days remaining')
      expect(block).not.toContain('Do not describe Election Day')
    })

    it('is PASSED afterwards, counting days since', () => {
      const block = buildCalendarBlock({
        today: parseISO('2026-11-10'),
        dates: [election('2026-11-03', null)],
        windows: [],
      })
      expect(block).toContain(
        'Status: PASSED\n' +
          'Days since: 7\n' +
          'Approved description: "Election Day was Tuesday, November 3."\n' +
          'Do not describe Election Day as upcoming.',
      )
      expect(
        buildCalendarBlock({
          today: parseISO('2026-11-04'),
          dates: [election('2026-11-03', null)],
          windows: [],
        }),
      ).toContain('Days since: 1\n')
    })

    it('renders the primary, capitalized only where it starts a sentence', () => {
      const primary = (record: string | null, live: string | null) => ({
        heading: 'PRIMARY ELECTION',
        name: 'the primary',
        record,
        live,
      })
      expect(build({ dates: [primary(null, '2027-03-02')] })).toContain(
        'PRIMARY ELECTION (election data)\n' +
          'Tuesday, March 2, 2027\n' +
          'Status: UPCOMING\n' +
          'Days remaining: 141\n' +
          'Approved description: "The primary is Tuesday, March 2."\n' +
          'Do not describe the primary as past.',
      )
      expect(build({ dates: [primary('2026-05-19', null)] })).toContain(
        'Approved description: "The primary was Tuesday, May 19."',
      )
      expect(build({ dates: [primary('2026-03-17', '2026-05-19')] })).toContain(
        'Reason: conflicting_sources\n' +
          'Campaign record: Tuesday, March 17, 2026\n' +
          'Election data: Tuesday, May 19, 2026\n' +
          'Approved description: "Confirm the date of the primary before planning around it."',
      )
    })

    it('is UNKNOWN with both source-tagged dates when the record and the live data disagree', () => {
      const block = build({ dates: [election('2027-04-06', '2027-02-23')] })
      expect(block).toContain(
        'ELECTION DAY\n' +
          'Status: UNKNOWN\n' +
          'Reason: conflicting_sources\n' +
          'Campaign record: Tuesday, April 6, 2027\n' +
          'Election data: Tuesday, February 23, 2027\n' +
          'Approved description: "Confirm the date of Election Day before planning around it."\n' +
          'Do not state the date of Election Day as settled.',
      )
      expect(block).not.toContain('Days remaining')
    })

    it('prefers the live date when both agree and the record when only it exists', () => {
      expect(
        build({ dates: [election('2026-11-03', '2026-11-03')] }),
      ).toContain('ELECTION DAY (election data)')
      expect(build({ dates: [election('2026-11-03', null)] })).toContain(
        'ELECTION DAY (campaign record)',
      )
      expect(build({ dates: [election(null, '2026-11-03')] })).toContain(
        'ELECTION DAY (election data)',
      )
    })
  })

  it('keeps the cautions on when the switch is unset', () => {
    expect(
      build({ windows: [earlyVoting('2026-10-19', '2026-11-02')] }),
    ).toContain('Do not describe early voting as currently open.')
  })

  it('leaves the cautions out when asked, keeping everything else', () => {
    const block = build({
      cautions: false,
      dates: [
        {
          heading: 'ELECTION DAY',
          name: 'Election Day',
          record: '2026-11-03',
          live: null,
        },
      ],
      windows: [earlyVoting('2026-10-19', '2026-11-02')],
    })
    expect(block).not.toContain('Do not')
    expect(block).toContain('Status: NOT YET OPEN')
    expect(block).toContain(
      'Approved description: "Election Day is Tuesday, November 3."',
    )
  })

  it('lists dates before windows, in the order given', () => {
    const block = build({
      dates: [
        {
          heading: 'ELECTION DAY',
          name: 'Election Day',
          record: '2026-11-03',
          live: null,
        },
      ],
      windows: [earlyVoting('2026-10-19', '2026-11-02')],
    })!
    expect(block.indexOf('ELECTION DAY')).toBeLessThan(
      block.indexOf('EARLY VOTING'),
    )
  })
})
