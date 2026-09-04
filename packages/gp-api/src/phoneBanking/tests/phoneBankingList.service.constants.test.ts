import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHONE_BANKING_SHEET_SIZE } from '@goodparty_org/contracts'

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
