import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PHONE_BANKING_PURPOSE_VALUES,
  PHONE_BANKING_SHEET_SIZE,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
} from '@goodparty_org/contracts'
import {
  PURPOSE_FROM_DB,
  PURPOSE_TO_DB,
} from '../services/phoneBankingList.service'

// PHONE_BANKING_SHEET_SIZE must be defined exactly once, in contracts
// (ENG-10941) — this pins the service to importing it rather than
// redeclaring the entry-cap-per-sheet literal locally, which is how the
// webapp's sheets-step coverage copy silently drifted from the server's
// actual cap in the first place.
describe('PhoneBankingListService constants', () => {
  it('imports PHONE_BANKING_SHEET_SIZE from contracts and defines no local copy', () => {
    const source = readFileSync(
      join(__dirname, '../services/phoneBankingList.service.ts'),
      'utf-8',
    )

    expect(source).toMatch(
      /import\s*{[^}]*PHONE_BANKING_SHEET_SIZE[^}]*}\s*from\s*'@goodparty_org\/contracts'/s,
    )
    expect(source).not.toMatch(/const PHONE_BANKING_SHEET_SIZE\s*=/)
  })

  it('is 60 — the entries-per-sheet cap the freeze and the print PDF split on', () => {
    expect(PHONE_BANKING_SHEET_SIZE).toBe(60)
  })
})

// PURPOSE_TO_DB/PURPOSE_FROM_DB are keyed over the Win|Serve purpose union
// (ENG-10985) — every slug in either contracts vocabulary must round-trip
// through the snake_case DB enum and back to its original kebab-case slug.
describe('PURPOSE_TO_DB / PURPOSE_FROM_DB', () => {
  const allPurposes = [
    ...new Set([
      ...PHONE_BANKING_PURPOSE_VALUES,
      ...SERVE_PHONE_BANKING_PURPOSE_VALUES,
    ]),
  ]

  it.each(allPurposes)('round-trips %s through the DB enum', (purpose) => {
    const dbValue = PURPOSE_TO_DB[purpose]
    expect(dbValue).toBeDefined()
    expect(PURPOSE_FROM_DB[dbValue]).toBe(purpose)
  })

  it('has exactly one DB enum entry per contracts purpose slug', () => {
    expect(Object.keys(PURPOSE_TO_DB).sort()).toEqual([...allPurposes].sort())
    expect(Object.keys(PURPOSE_FROM_DB)).toHaveLength(allPurposes.length)
  })
})
