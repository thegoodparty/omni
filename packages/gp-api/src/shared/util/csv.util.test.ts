import { describe, expect, it } from 'vitest'
import { csvEscape, csvShape, neutralizeCsvFormula } from './csv.util'

describe('neutralizeCsvFormula', () => {
  it('prefixes a quote for cells starting with a formula character', () => {
    for (const char of ['=', '+', '-', '@']) {
      expect(neutralizeCsvFormula(`${char}HYPERLINK("http://evil")`)).toBe(
        `'${char}HYPERLINK("http://evil")`,
      )
    }
  })

  it('leaves ordinary values untouched', () => {
    expect(neutralizeCsvFormula('First Name')).toBe('First Name')
    expect(neutralizeCsvFormula('Age 30+')).toBe('Age 30+')
    expect(neutralizeCsvFormula('')).toBe('')
  })
})

describe('csvShape', () => {
  it('counts the recipient rows, not the header', () => {
    const csv = Buffer.from('lead_phone\n5551230000\n5551230001\n', 'utf8')
    expect(csvShape(csv)).toEqual({
      bytes: csv.length,
      rows: 2,
      controlCharRows: 0,
    })
  })

  it('counts rows carrying a control character', () => {
    const csv = Buffer.from(
      'lead_phone,lead_city\n5551230000,"Apt 2\rNorth"\n5551230001,Oakland\n',
      'utf8',
    )
    expect(csvShape(csv)).toMatchObject({ rows: 2, controlCharRows: 1 })
  })

  it('reports nothing for an empty file', () => {
    expect(csvShape(Buffer.from('', 'utf8'))).toEqual({
      bytes: 0,
      rows: 0,
      controlCharRows: 0,
    })
  })
})

describe('csvEscape', () => {
  it('returns an empty cell for null and undefined', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
  })

  it('quotes values containing commas, quotes, or newlines', () => {
    expect(csvEscape('Smith, Jr.')).toBe('"Smith, Jr."')
    expect(csvEscape('5\'9" tall')).toBe('"5\'9"" tall"')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('plain')).toBe('plain')
  })

  // A lone carriage return is a row break to every CSV reader, so an
  // unquoted one splits the row in two and the file is refused whole.
  it('quotes a value carrying a bare carriage return', () => {
    expect(csvEscape('Apt 2\rNorth')).toBe('"Apt 2\rNorth"')
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('neutralizes formula-starting values', () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    )
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('neutralizes a formula value that also needs quoting', () => {
    expect(csvEscape('=cmd|calc,x')).toBe('"\'=cmd|calc,x"')
  })

  it('exempts inert numeric values so phones and negatives survive', () => {
    expect(csvEscape('+15551234567')).toBe('+15551234567')
    expect(csvEscape('-42')).toBe('-42')
    expect(csvEscape('+1 (555) 123-4567')).toBe('+1 (555) 123-4567')
  })

  it('still neutralizes +/- values carrying non-numeric content', () => {
    expect(csvEscape('-HYPERLINK(1)')).toBe("'-HYPERLINK(1)")
    expect(csvEscape('+cmd|calc')).toBe("'+cmd|calc")
  })
})
