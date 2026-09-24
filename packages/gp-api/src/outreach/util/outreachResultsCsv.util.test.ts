import { describe, expect, it } from 'vitest'
import {
  checkResultsCsv,
  EMPTY_FILE_MESSAGE,
  EMPTY_NAME_MESSAGE,
  MAX_RESULTS_CSV_BYTES,
  normalizeResultsHeader,
  parseResultsCsv,
  TOO_LARGE_MESSAGE,
  TRUNCATED_MESSAGE,
} from './outreachResultsCsv.util'

const ok = (result: ReturnType<typeof parseResultsCsv>) => {
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result
}

describe('normalizeResultsHeader', () => {
  it('folds the spellings the analysis pipeline already accepts onto one', () => {
    expect(normalizeResultsHeader('phone_number')).toBe('phone number')
    expect(normalizeResultsHeader('  Contact Phone Number ')).toBe(
      'contact phone number',
    )
    expect(normalizeResultsHeader('﻿"Message Text"')).toBe('message text')
  })
})

describe('parseResultsCsv', () => {
  it('reads the pipeline header spellings', () => {
    const result = ok(
      parseResultsCsv(
        'Contact Phone Number,Message Text,Sent At,Send Direction\n' +
          '3035550101,Fix the potholes,2026-08-11T15:04:05.000Z,INBOUND\n',
      ),
    )
    expect(result.rows).toEqual([
      {
        phone: '3035550101',
        content: 'Fix the potholes',
        receivedAt: new Date('2026-08-11T15:04:05.000Z'),
      },
    ])
    expect(result.skipped).toEqual([])
  })

  it('reads the snake_case spellings as the same columns', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,Hello,INBOUND\n',
      ),
    )
    expect(result.rows).toEqual([{ phone: '3035550101', content: 'Hello' }])
  })

  it('keeps a reply that contains commas, quotes and newlines intact', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,"Two things, actually:\n' +
          '1) the ""crossing"" on Elm\n' +
          '2) the streetlight",INBOUND\n',
      ),
    )
    expect(result.rows[0]?.content).toBe(
      'Two things, actually:\n1) the "crossing" on Elm\n2) the streetlight',
    )
  })

  it('refuses a file cut off inside a quoted value rather than undercounting it', () => {
    const result = parseResultsCsv(
      'phone_number,message_text,send_direction\n' +
        '3035550101,"the tail of this file is mis',
    )
    expect(result).toEqual({ ok: false, error: TRUNCATED_MESSAGE })
  })

  it('names the column that is missing, and what it could have been called', () => {
    const result = parseResultsCsv(
      'phone_number,when,send_direction\n3035550101,today,INBOUND\n',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('message_text or Message Text')
    expect(result.error).toContain('Found: phone_number, when')
  })

  it('skips a row with no phone and reports the spreadsheet line', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,Hello,INBOUND\n' +
          ',Orphan reply,INBOUND\n',
      ),
    )
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toEqual([{ line: 3, reason: 'no phone number' }])
  })

  it('treats an empty timestamp cell as no timestamp, not a bad one', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,sent_at,send_direction\n' +
          '3035550101,Hi,,INBOUND\n',
      ),
    )
    expect(result.rows).toEqual([{ phone: '3035550101', content: 'Hi' }])
    expect(result.skipped).toEqual([])
  })

  // The fulfilment export is a message log: it carries the official's own
  // outbound text to every recipient alongside the replies. Ingesting those
  // would turn one send to 54 people into 54 fabricated responses.
  it('keeps only inbound rows, skipping the outbound half of the exchange', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,Budget hearing Tuesday.,OUTBOUND\n' +
          '3035550101,I will be there,INBOUND\n' +
          '3035550102,Budget hearing Tuesday.,Outbound\n',
      ),
    )
    expect(result.rows).toEqual([
      { phone: '3035550101', content: 'I will be there' },
    ])
    // Counted, not "skipped": an outbound row read fine and is simply not a
    // reply. Reporting it as a failed row told the operator that 32 rows of
    // a correct 44-row file could not be read.
    expect(result.outboundRows).toBe(2)
    expect(result.skipped).toEqual([])
  })

  // Matches the poll pipeline, whose model types send_direction as required
  // while carrier / send_status / error_code are Optional. Defaulting to
  // "inbound" would silently accept the whole log.
  it('refuses a file with no direction column rather than assuming inbound', () => {
    const result = parseResultsCsv(
      'phone_number,message_text\n3035550101,Hello\n',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('send_direction or Send Direction')
  })

  it('skips a row whose direction cell is blank', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,Hi,\n' +
          '3035550102,Hey,INBOUND\n',
      ),
    )
    expect(result.rows).toHaveLength(1)
    expect(result.outboundRows).toBe(0)
    expect(result.skipped).toEqual([{ line: 2, reason: 'no send direction' }])
  })

  it('ignores blank lines between rows', () => {
    const result = ok(
      parseResultsCsv(
        'phone_number,message_text,send_direction\n' +
          '3035550101,Hi,INBOUND\n\n3035550102,Hey,INBOUND\n',
      ),
    )
    expect(result.rows).toHaveLength(2)
    expect(result.skipped).toEqual([])
  })
})

describe('checkResultsCsv', () => {
  const csv =
    'phone_number,message_text,send_direction\n3035550101,Hi,INBOUND\n'

  it('refuses a nameless or empty file before parsing it', () => {
    expect(checkResultsCsv({ fileName: '  ', csv })).toEqual({
      ok: false,
      error: EMPTY_NAME_MESSAGE,
    })
    expect(checkResultsCsv({ fileName: 'r.csv', csv: '\n\n' })).toEqual({
      ok: false,
      error: EMPTY_FILE_MESSAGE,
    })
  })

  it('measures the size in bytes, so a UTF-8 body cannot slip past the cap', () => {
    // Every character here is 3 bytes, so a string a third of the cap long
    // is exactly over it by byte count and comfortably under by length.
    const wide = '✉'.repeat(MAX_RESULTS_CSV_BYTES / 3 + 1)
    const result = checkResultsCsv({ fileName: 'r.csv', csv: wide })
    expect(result).toEqual({ ok: false, error: TOO_LARGE_MESSAGE })
    expect(wide.length).toBeLessThan(MAX_RESULTS_CSV_BYTES)
  })

  it('parses a file that clears the file-level checks', () => {
    expect(ok(checkResultsCsv({ fileName: 'results.csv', csv })).rows).toEqual([
      { phone: '3035550101', content: 'Hi' },
    ])
  })
})
