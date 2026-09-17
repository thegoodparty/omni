import { describe, expect, it } from 'vitest'
import {
  DOWNLOAD_COLUMNS,
  EXCLUDABLE_VOTER_COLUMNS,
  buildVoterSelectSql,
} from './voter.select'

describe('DOWNLOAD_COLUMNS', () => {
  it('has no duplicate columns', () => {
    const columns = DOWNLOAD_COLUMNS.map(({ column }) => column)
    expect(new Set(columns).size).toBe(columns.length)
  })

  it('carries a non-empty friendly header for every column', () => {
    for (const { header } of DOWNLOAD_COLUMNS) {
      expect(header.length).toBeGreaterThan(0)
    }
  })

  it('includes the party-visibility excludable column', () => {
    const columns = new Set(DOWNLOAD_COLUMNS.map(({ column }) => column))
    for (const excludable of EXCLUDABLE_VOTER_COLUMNS) {
      expect(columns.has(excludable)).toBe(true)
    }
  })

  // A Serve download excludes exactly EXCLUDABLE_VOTER_COLUMNS, so a party,
  // turnout-propensity, or vote-history column added to the CSV without a
  // matching entry there leaks a Win-only field into an `eo-` org's export.
  // That is invisible in every other test: the column is simply present.
  it('marks every party, turnout, and vote-history column excludable', () => {
    const excludable = new Set<string>(EXCLUDABLE_VOTER_COLUMNS)
    const isRestricted = (column: string) =>
      /Parties|VotingPerformance/.test(column) ||
      /^(General|Primary|PresidentialPrimary)_\d{4}$/.test(column) ||
      /^(AnyElection|OtherElection)_\d{4}$/.test(column)
    const leaked = DOWNLOAD_COLUMNS.filter(
      ({ column }) => isRestricted(column) && !excludable.has(column),
    ).map(({ column }) => column)
    expect(leaked).toEqual([])
  })
})

describe('excludeColumns filtering (mirrors peopleDownload.service usage)', () => {
  const filterExcluded = (excludeColumns: readonly string[]) => {
    const excluded = new Set<string>(excludeColumns)
    return DOWNLOAD_COLUMNS.filter(({ column }) => !excluded.has(column))
  }

  it('returns every column when nothing is excluded', () => {
    expect(filterExcluded([])).toHaveLength(DOWNLOAD_COLUMNS.length)
  })

  it('drops exactly the requested column', () => {
    const filtered = filterExcluded(['Parties_Description'])
    expect(filtered).toHaveLength(DOWNLOAD_COLUMNS.length - 1)
    expect(
      filtered.some(({ column }) => column === 'Parties_Description'),
    ).toBe(false)
  })

  it('leaves other columns untouched when excluding one', () => {
    const filtered = filterExcluded(['Parties_Description'])
    expect(filtered.some(({ column }) => column === 'FirstName')).toBe(true)
  })
})

describe('buildVoterSelectSql', () => {
  it('dedupes duplicate extra fields', () => {
    const { columnNames } = buildVoterSelectSql([
      'StateVoterID',
      'StateVoterID',
    ])
    const occurrences = columnNames.filter((c) => c === 'StateVoterID').length
    expect(occurrences).toBe(1)
  })

  it('appends extra fields not already in the base select', () => {
    const { columnNames } = buildVoterSelectSql(['StateVoterID'])
    expect(columnNames).toContain('StateVoterID')
  })

  it('produces a SELECT statement with quoted, aliased columns', () => {
    const { sql } = buildVoterSelectSql()
    const text = sql.strings.join('?')
    expect(text).toContain('SELECT')
    expect(text).toContain('"id"')
  })
})
