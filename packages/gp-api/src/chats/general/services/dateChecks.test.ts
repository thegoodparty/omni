import { describe, expect, it } from 'vitest'
import {
  DATE_CHECK_PREFIX,
  dateCheckFindings,
  dateCheckLine,
  scheduleCoverage,
  weekdayPairs,
} from './dateChecks'

// 2026: October 12 is a Monday, October 31 a Saturday, November 1 a Sunday,
// November 3 a Tuesday.
const TODAY = new Date(2026, 9, 12)
const TODAY_ISO = '2026-10-12'

const pairsOf = (text: string, today = TODAY) =>
  weekdayPairs(text, today).map((p) => `${p.text}${p.wrong ? ' WRONG' : ''}`)

const findingsOf = (text: string) => {
  const f = dateCheckFindings(text, TODAY_ISO)
  return {
    pairs: f.pairs,
    wrong: f.wrongPairs.map((p) => p.text),
    missing: f.missingDays,
    doubled: f.doubledDays,
    items: f.items,
  }
}

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]
// October 13 onward, i days later, as "Month D".
const dayFrom13 = (i: number): string => {
  const day = 13 + i
  return day > 31 ? `November ${day - 31}` : `October ${day}`
}

// A seven-day countdown that drops October 31 and keeps the weekdays
// consecutive, so the three days after it carry the wrong weekday and
// Election Day heads two entries.
const DROPPED_DAY = [
  '**Day 7 -- Wednesday, October 28**',
  'post',
  '**Day 6 -- Thursday, October 29**',
  'post',
  '**Day 5 -- Friday, October 30**',
  'post',
  '**Day 4 -- Saturday, November 1**',
  'post',
  '**Day 3 -- Sunday, November 2**',
  'post',
  '**Day 2 -- Monday, November 3 (Election Eve)**',
  'post',
  '**Day 1 -- Tuesday, November 3 (Election Day)**',
  'post',
].join('\n')

// Three weeks of posts whose every weekday is one day early: last year's
// calendar for those dates.
const SHIFTED_WEEKS = Array.from(
  { length: 21 },
  (_, i) => `**DAY ${i + 1} -- ${WEEKDAYS[i % 7]}, ${dayFrom13(i)}**\npost`,
).join('\n')

// The same three weeks written with no weekday on any date, with the day
// before Election Day left out.
const NO_WEEKDAYS = [
  ...Array.from(
    { length: 20 },
    (_, i) => `**${dayFrom13(i)} -- Day ${i + 1}**\npost`,
  ),
  '**November 3 -- Election Day**\npost',
].join('\n')

describe('weekdayPairs', () => {
  it('reads every written form and checks each against the calendar', () => {
    const text = [
      'Monday, October 12 is today.',
      'Submit by Fri., Oct. 16th, 2026.',
      'Then Saturday October 17 and Sunday (October 18).',
      'October 19 (Monday) early voting opens; October 20, Tuesday follows.',
      'Mon 10/26 and Tue 10/27/2026 close it out.',
    ].join(' ')
    expect(pairsOf(text)).toEqual([
      'Monday, October 12',
      'Fri., Oct. 16th, 2026',
      'Saturday October 17',
      'Sunday (October 18',
      'October 19 (Monday',
      'October 20, Tuesday',
      'Mon 10/26',
      'Tue 10/27/2026',
    ])
  })

  it('names the pair as written when the weekday is wrong', () => {
    expect(pairsOf('Post it by this Friday, Oct. 17 at the latest.')).toEqual([
      'Friday, Oct. 17 WRONG',
    ])
    expect(pairsOf('Monday, October 13 kicks it off.')).toEqual([
      'Monday, October 13 WRONG',
    ])
  })

  it('gives each date of a consecutive list its own weekday', () => {
    expect(
      pairsOf(
        'Monday, October 19, Tuesday, October 20, Wednesday, October 21.',
      ),
    ).toEqual([
      'Monday, October 19',
      'Tuesday, October 20',
      'Wednesday, October 21',
    ])
  })

  it('reads a month-first list each date with its own weekday', () => {
    expect(
      pairsOf(
        'October 13 (Tuesday), October 14 (Wednesday), October 15 (Thursday).',
      ),
    ).toEqual([
      'October 13 (Tuesday',
      'October 14 (Wednesday',
      'October 15 (Thursday',
    ])
    expect(pairsOf('October 12, Monday, October 13, Tuesday.')).toEqual([
      'October 12, Monday',
      'October 13, Tuesday',
    ])
  })

  it('allows either adjacent year for a date three or more months back', () => {
    // May 4 was a Monday in 2026 and is a Tuesday in 2027, next spring's primary.
    expect(pairsOf('The primary is Tuesday, May 4.')).toEqual([
      'Tuesday, May 4',
    ])
    expect(pairsOf('Last spring was Monday, May 4.')).toEqual(['Monday, May 4'])
    expect(pairsOf('The primary is Friday, May 4.')).toEqual([
      'Friday, May 4 WRONG',
    ])
    // August is two months back and settled: August 3, 2026 was a Monday.
    expect(pairsOf('Back on Monday, August 3.')).toEqual(['Monday, August 3'])
    expect(pairsOf('Back on Tuesday, August 3.')).toEqual([
      'Tuesday, August 3 WRONG',
    ])
  })

  it('gives each date of a range its own weekday', () => {
    expect(
      pairsOf('Week 1 runs Tuesday, October 13 – Monday, October 19.'),
    ).toEqual(['Tuesday, October 13', 'Monday, October 19'])
  })

  it('allows either adjacent year for a date six months or more ahead', () => {
    // March 3 was a Tuesday in 2026 and is a Wednesday in 2027.
    expect(pairsOf('The primary was Tuesday, March 3.')).toEqual([
      'Tuesday, March 3',
    ])
    expect(pairsOf('The primary was Wednesday, March 3.')).toEqual([
      'Wednesday, March 3',
    ])
    expect(pairsOf('The primary was Friday, March 3.')).toEqual([
      'Friday, March 3 WRONG',
    ])
  })

  it('reads a year the reply writes, and otherwise the year nearest today', () => {
    // May 22, 2027 is a Saturday.
    expect(pairsOf('The deadline is Friday, May 22, 2027.')).toEqual([
      'Friday, May 22, 2027 WRONG',
    ])
    expect(pairsOf('The deadline is Saturday, May 22, 2027.')).toEqual([
      'Saturday, May 22, 2027',
    ])
    // January 4 is a Monday in 2027 and was a Sunday in 2026; read from
    // October 2026 either year fits, and only a third weekday is wrong.
    expect(pairsOf('Back on Monday, January 4.')).toEqual(['Monday, January 4'])
    expect(pairsOf('Back on Sunday, January 4.')).toEqual(['Sunday, January 4'])
    expect(pairsOf('Back on Tuesday, January 4.')).toEqual([
      'Tuesday, January 4 WRONG',
    ])
    // December 31, 2026 is a Thursday; read from February 2027 it is last
    // year's.
    expect(
      pairsOf('Filed on Thursday, December 31.', new Date(2027, 1, 10)),
    ).toEqual(['Thursday, December 31'])
    // A two-digit year on a numeric date is this century's.
    expect(pairsOf('Mon 10/26/26 and Tue 10/27/26.')).toEqual([
      'Mon 10/26/26',
      'Tue 10/27/26',
    ])
  })

  it('does not take a count after a date for its year', () => {
    expect(pairsOf('Monday, October 12, 1500 doors knocked.')).toEqual([
      'Monday, October 12',
    ])
  })

  it('ignores fractions, the verb may, and a pair split across lines', () => {
    expect(pairsOf('Friday 1/2 of voters and Fri 3/4 of the ward.')).toEqual([])
    expect(pairsOf('Friday may 5 people show up.')).toEqual([])
    expect(pairsOf('Tuesday\n\nOctober 14 is the launch.')).toEqual([])
  })

  it('ignores a date with no weekday and a day that does not exist', () => {
    expect(pairsOf('Election Day is November 3.')).toEqual([])
    expect(pairsOf('Monday, February 30')).toEqual([])
  })
})

describe('scheduleCoverage', () => {
  it('finds the dropped day and the doubled day in a countdown', () => {
    const c = scheduleCoverage(DROPPED_DAY, TODAY)!
    expect(c.missing).toEqual(['2026-10-31'])
    expect(c.doubled).toEqual(['2026-11-03'])
  })

  it('reads a complete schedule as complete', () => {
    const c = scheduleCoverage(SHIFTED_WEEKS, TODAY)!
    expect(c.missing).toEqual([])
    expect(c.doubled).toEqual([])
  })

  it('reads headings written without weekdays', () => {
    expect(scheduleCoverage(NO_WEEKDAYS, TODAY)!.missing).toEqual([
      '2026-11-02',
    ])
  })

  it('reads a schedule that crosses the year', () => {
    const text = [
      'December 29',
      'December 30',
      'December 31',
      'January 1',
      'January 2',
    ]
      .map((d) => `## ${d}\npost`)
      .join('\n')
    expect(scheduleCoverage(text, new Date(2026, 11, 20))!.missing).toEqual([])
  })

  it('is not read as a schedule below five dated headings', () => {
    const four = DROPPED_DAY.split('\n').slice(0, 8).join('\n')
    expect(scheduleCoverage(four, TODAY)).toBeNull()
  })

  it('is read at four days in five and not below', () => {
    const on = (days: number[]) =>
      days.map((d) => `## October ${d}\npost`).join('\n')
    // 8 of 10 days.
    expect(
      scheduleCoverage(on([12, 13, 14, 15, 16, 17, 19, 21]), TODAY)!.missing,
    ).toEqual(['2026-10-18', '2026-10-20'])
    // 5 of 6 days.
    expect(scheduleCoverage(on([12, 13, 14, 16, 17]), TODAY)!.missing).toEqual([
      '2026-10-15',
    ])
    // 5 of 7 days.
    expect(scheduleCoverage(on([12, 13, 14, 16, 18]), TODAY)).toBeNull()
    // Three days a week.
    expect(scheduleCoverage(on([12, 14, 16, 19, 21, 23]), TODAY)).toBeNull()
  })

  it('is read up to sixty days and not beyond', () => {
    const from = new Date(2026, 9, 1)
    const run = (span: number) =>
      Array.from({ length: span }, (_, i) => {
        const d = new Date(from)
        d.setDate(d.getDate() + i)
        return `## ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getDate()}\npost`
      }).join('\n')
    expect(scheduleCoverage(run(60), TODAY)).not.toBeNull()
    expect(scheduleCoverage(run(61), TODAY)).toBeNull()
  })

  it('skips week headers and keeps a heading followed by a count', () => {
    const text = [
      '## WEEK 1 -- October 13-19',
      '**Tuesday, October 13 -- 21 days out**',
      '**Wednesday, October 14 -- 20 days out**',
      '**Thursday, October 15 -- 19 days out**',
      '**Friday, October 16 -- 18 days out**',
      '**Saturday, October 17 -- 17 days out**',
      '## October 20 -- October 26',
      '**Sunday, October 18 -- 16 days out**',
      '**Monday, October 19 -- 15 days out**',
    ].join('\npost\n')
    const c = scheduleCoverage(text, TODAY)!
    expect(c.missing).toEqual([])
    expect(c.doubled).toEqual([])
  })

  it('reads a weekday plan over weekdays', () => {
    const on = (days: number[]) =>
      days.map((d) => `## October ${d}\npost`).join('\n')
    // Monday to Friday, two weeks.
    expect(
      scheduleCoverage(on([12, 13, 14, 15, 16, 19, 20, 21, 22, 23]), TODAY)!
        .missing,
    ).toEqual([])
    // The same with a Wednesday left out.
    expect(
      scheduleCoverage(on([12, 13, 15, 16, 19, 20, 21, 22, 23]), TODAY)!
        .missing,
    ).toEqual(['2026-10-14'])
  })

  it('does not count a week header with weekdays as a day', () => {
    const text = [
      '**Tuesday, October 13 - Monday, October 19**',
      '**Tuesday, October 13**',
      '**Wednesday, October 14**',
      '**Thursday, October 15**',
      '**Friday, October 16**',
      '**Saturday, October 17**',
      '**Sunday, October 18**',
      '**Monday, October 19**',
    ].join('\npost\n')
    const c = scheduleCoverage(text, TODAY)!
    expect(c.doubled).toEqual([])
    expect(c.missing).toEqual([])
  })

  it('keeps a heading followed by a count, a time, or a small number', () => {
    const on = (suffix: string) =>
      [13, 14, 15, 16, 17]
        .map((d) => `**October ${d}${suffix}**\npost`)
        .join('\n')
    expect(scheduleCoverage(on(' -- 3 posts'), TODAY)!.missing).toEqual([])
    expect(
      scheduleCoverage(on(' - 9:00 AM: knock doors'), TODAY)!.missing,
    ).toEqual([])
    expect(scheduleCoverage(on(' -- 3'), TODAY)!.missing).toEqual([])
    // A number larger than the day after a dash is the end of a range.
    expect(scheduleCoverage(on('-19'), TODAY)).toBeNull()
  })

  it('reads a table row as a heading', () => {
    const rows = ['12', '13', '14', '15', '17']
      .map((d) => `| October ${d} | post |`)
      .join('\n')
    expect(scheduleCoverage(rows, TODAY)!.missing).toEqual(['2026-10-16'])
  })
})

describe('dateCheckFindings', () => {
  it('reports the dropped day as wrong weekdays, a missing day and a doubled day', () => {
    expect(findingsOf(DROPPED_DAY)).toEqual({
      pairs: 7,
      wrong: [
        'Saturday, November 1',
        'Sunday, November 2',
        'Monday, November 3',
      ],
      missing: ['2026-10-31'],
      doubled: ['2026-11-03'],
      items: [
        'October 31 has no entry',
        'November 1 is a Sunday, not a Saturday',
        'November 2 is a Monday, not a Sunday',
        'November 3 is a Tuesday, not a Monday',
        'November 3 has two entries',
      ],
    })
  })

  it('reports every pair of a shifted schedule and no coverage finding', () => {
    const f = findingsOf(SHIFTED_WEEKS)
    expect(f.pairs).toBe(21)
    expect(f.wrong).toHaveLength(21)
    expect(f.missing).toEqual([])
    expect(f.items[0]).toBe('October 13 is a Tuesday, not a Monday')
    expect(f.items).toHaveLength(21)
  })

  it('sees a dropped day when no weekday is written at all', () => {
    expect(findingsOf(NO_WEEKDAYS)).toEqual({
      pairs: 0,
      wrong: [],
      missing: ['2026-11-02'],
      doubled: [],
      items: ['November 2 has no entry'],
    })
  })

  it('does not call a second schedule a doubled day', () => {
    const twice = `${SHIFTED_WEEKS}\n\n## Email version\n${SHIFTED_WEEKS}`
    const f = findingsOf(twice)
    expect(f.doubled).toHaveLength(21)
    expect(f.items.some((i) => i.endsWith('two entries'))).toBe(false)
  })

  it('counts a repeated wrong pair once among the items', () => {
    const f = findingsOf(
      'Submit by Friday, Oct. 17. Again: Friday, October 17th is the day.',
    )
    expect(f.wrong).toHaveLength(2)
    expect(f.items).toEqual(['October 17 is a Saturday, not a Friday'])
  })

  it('finds nothing in a reply with no dates or only right ones', () => {
    expect(findingsOf('Here is your donor email draft.').items).toEqual([])
    expect(
      findingsOf(
        'Early voting opens Monday, October 19 and closes Monday, November 2.',
      ).items,
    ).toEqual([])
  })

  it('finds nothing when the local day does not parse', () => {
    expect(dateCheckFindings(SHIFTED_WEEKS, 'not a day').items).toEqual([])
  })
})

describe('dateCheckLine', () => {
  it('names the findings in date order', () => {
    expect(dateCheckLine(dateCheckFindings(NO_WEEKDAYS, TODAY_ISO))).toBe(
      `${DATE_CHECK_PREFIX}November 2 has no entry.`,
    )
    expect(dateCheckLine(dateCheckFindings(DROPPED_DAY, TODAY_ISO))).toBe(
      `${DATE_CHECK_PREFIX}October 31 has no entry; November 1 is a Sunday, not a Saturday; November 2 is a Monday, not a Sunday; November 3 is a Tuesday, not a Monday; and 1 more.`,
    )
  })

  it('names four and counts the rest', () => {
    expect(dateCheckLine(dateCheckFindings(SHIFTED_WEEKS, TODAY_ISO))).toBe(
      `${DATE_CHECK_PREFIX}October 13 is a Tuesday, not a Monday; October 14 is a Wednesday, not a Tuesday; October 15 is a Thursday, not a Wednesday; October 16 is a Friday, not a Thursday; and 17 more.`,
    )
  })

  it('is null when there is nothing to check', () => {
    expect(
      dateCheckLine(dateCheckFindings('No dates here.', TODAY_ISO)),
    ).toBeNull()
  })
})
