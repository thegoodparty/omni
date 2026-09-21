import { describe, it, expect } from 'vitest'
import {
  normalizeHeader,
  parseCsvRows,
  parseResultsCsv,
} from './parseResultsCsv'

const ok = (text: string) => {
  const result = parseResultsCsv(text)
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result
}

describe('normalizeHeader', () => {
  it('folds the pipeline spellings onto one key', () => {
    expect(normalizeHeader('phone_number')).toBe('phone number')
    expect(normalizeHeader('Contact Phone Number')).toBe('contact phone number')
    expect(normalizeHeader('  MESSAGE_TEXT ')).toBe('message text')
    expect(normalizeHeader('\uFEFFSent At')).toBe('sent at')
  })
})

describe('parseCsvRows', () => {
  it('keeps commas and newlines inside a quoted reply body', () => {
    const rows = parseCsvRows('a,"one, two\nthree",b')
    expect(rows).toEqual([['a', 'one, two\nthree', 'b']])
  })

  it('unescapes a doubled quote', () => {
    expect(parseCsvRows('"he said ""hi"""')).toEqual([['he said "hi"']])
  })

  it('treats CRLF as one row terminator', () => {
    expect(parseCsvRows('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseResultsCsv header spellings', () => {
  it('accepts the snake_case spellings', () => {
    const result = ok(
      'phone_number,message_text,sent_at\n5551234567,Fix Elm St,2026-09-16T14:00:00Z\n'
    )
    expect(result.columns).toEqual({
      phone: 'phone_number',
      content: 'message_text',
      receivedAt: 'sent_at',
    })
    expect(result.rows).toEqual([
      {
        phone: '5551234567',
        content: 'Fix Elm St',
        receivedAt: new Date('2026-09-16T14:00:00Z'),
      },
    ])
  })

  it('accepts the title-case spellings, and a BOM in front of them', () => {
    const result = ok(
      '\uFEFFContact Phone Number,Message Text,Sent At\n5551234567,Fix Elm St,2026-09-16T14:00:00Z\n'
    )
    expect(result.columns.phone).toBe('Contact Phone Number')
    expect(result.columns.content).toBe('Message Text')
    expect(result.columns.receivedAt).toBe('Sent At')
    expect(result.rows).toHaveLength(1)
  })

  it('does not care what order the columns are in, or about extra columns', () => {
    const result = ok(
      'first_name,Message Text,junk,phone_number\nAva,Fix Elm St,x,5551234567\n'
    )
    expect(result.rows).toEqual([
      { phone: '5551234567', content: 'Fix Elm St' },
    ])
  })

  it('treats the timestamp column as optional', () => {
    const result = ok('phone_number,message_text\n5551234567,Fix Elm St\n')
    expect(result.columns.receivedAt).toBeNull()
    expect(result.rows[0].receivedAt).toBeUndefined()
  })

  it('reads an empty timestamp cell as absent rather than invalid', () => {
    const result = ok('phone_number,message_text,sent_at\n5551234567,Hi,\n')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].receivedAt).toBeUndefined()
    expect(result.skipped).toEqual([])
  })
})

describe('parseResultsCsv refusals', () => {
  it('refuses a file with no phone column, naming what it accepts', () => {
    const result = parseResultsCsv('name,message_text\nAva,Hi\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('phone_number')
    expect(result.error).toContain('Contact Phone Number')
  })

  it('refuses a file with no message column', () => {
    const result = parseResultsCsv('phone_number,sent_at\n555,2026-09-16\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('message_text')
  })

  it('refuses an empty file', () => {
    expect(parseResultsCsv('')).toEqual({
      ok: false,
      error: 'That file is empty.',
    })
  })
})

describe('parseResultsCsv rows', () => {
  it('skips a row with no phone and says which line', () => {
    const result = ok(
      'phone_number,message_text\n5551234567,Hi\n,Orphan reply\n5559876543,Yes\n'
    )
    expect(result.rows).toHaveLength(2)
    expect(result.dataRows).toBe(3)
    expect(result.skipped).toEqual([{ line: 3, reason: 'no phone number' }])
  })

  it('skips a row whose timestamp cannot be read', () => {
    const result = ok(
      'phone_number,message_text,sent_at\n5551234567,Hi,not-a-date\n'
    )
    expect(result.rows).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].line).toBe(2)
  })

  it('keeps an empty reply body, which is a real thing people send', () => {
    const result = ok('phone_number,message_text\n5551234567,\n')
    expect(result.rows).toEqual([{ phone: '5551234567', content: '' }])
  })

  it('ignores blank lines rather than counting them as rows', () => {
    const result = ok('phone_number,message_text\n\n5551234567,Hi\n\n')
    expect(result.dataRows).toBe(1)
    expect(result.rows).toHaveLength(1)
  })

  it('carries a multi-line quoted reply through whole', () => {
    const result = ok(
      'phone_number,message_text\n5551234567,"Line one\nLine two, with a comma"\n'
    )
    expect(result.rows[0].content).toBe('Line one\nLine two, with a comma')
  })
})
