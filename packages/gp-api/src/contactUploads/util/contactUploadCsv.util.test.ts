import { Readable } from 'stream'
import { describe, expect, it } from 'vitest'
import {
  CONTACT_UPLOAD_MAX_ROWS,
  type ContactUploadColumnMapping,
} from '@goodparty_org/contracts'
import {
  ContactUploadFileError,
  normalizePhone,
  normalizeZip,
  readContactUploadCsv,
} from './contactUploadCsv.util'

const MAPPING: ContactUploadColumnMapping = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  cellPhone: 'Mobile',
  landline: null,
  addressLine: 'Street',
  city: null,
  zip: 'Zip',
}

const parse = async (csv: string, mapping = MAPPING) => {
  const rows = []
  for await (const row of readContactUploadCsv(
    Readable.from([Buffer.from(csv)]),
    mapping,
  )) {
    rows.push(row)
  }
  return rows
}

describe('readContactUploadCsv', () => {
  it('maps by the chosen headers and normalizes each field', async () => {
    const rows = await parse(
      '\uFEFFFirst,Last,Email,Mobile,Street,Zip,Ignored\r\n' +
        ' Jane ,Doe,JANE@Example.COM,616.555.0142,"123 Oak St, Apt 4",49503-1234,x\r\n',
    )

    expect(rows).toEqual([
      {
        rowIndex: 0,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        cellPhone: '(616) 555-0142',
        landline: null,
        addressLine: '123 Oak St, Apt 4',
        city: null,
        zip: '49503',
        hasName: true,
      },
    ])
  })

  it('drops an invalid email but keeps the row, and flags a row without a full name', async () => {
    const rows = await parse(
      'First,Last,Email,Mobile,Street,Zip\n' +
        'Jane,Doe,not-an-email,,,\n' +
        ',Smith,smith@example.com,,,\n',
    )

    expect(rows.map((row) => [row.email, row.hasName])).toEqual([
      [null, true],
      ['smith@example.com', false],
    ])
  })

  it('fails a file missing a mapped header, naming the column', async () => {
    await expect(
      parse('First,Last,Email,Mobile,Street\nJane,Doe,,,\n'),
    ).rejects.toThrow(
      new ContactUploadFileError(
        'This file has no column named "Zip". Import it again and pick columns it has.',
      ),
    )
  })

  it('fails a header row only', async () => {
    await expect(parse('First,Last,Email,Mobile,Street,Zip\n')).rejects.toThrow(
      new ContactUploadFileError(
        'This file has no people in it. Add them and import it again.',
      ),
    )
  })

  it('fails a file over the row limit', async () => {
    const minimal = {
      ...MAPPING,
      email: null,
      cellPhone: null,
      addressLine: null,
      zip: null,
    }
    await expect(
      parse(
        `First,Last\n${'Jane,Doe\n'.repeat(CONTACT_UPLOAD_MAX_ROWS + 1)}`,
        minimal,
      ),
    ).rejects.toThrow(
      new ContactUploadFileError(
        'This file has more than 100,000 people. Split it into smaller files and import each one.',
      ),
    )
  })

  it('fails a file it cannot read, like a quote that never closes', async () => {
    await expect(
      parse(
        `First,Last,Email,Mobile,Street,Zip\nJane,"Doe${',x'.repeat(40_000)}\n`,
      ),
    ).rejects.toThrow(
      new ContactUploadFileError(
        "We couldn't read this file. Save it as a CSV and import it again.",
      ),
    )
  })

  it('rethrows an error from the source stream as is', async () => {
    const source = new Readable({ read: () => undefined })
    const reading = (async () => {
      for await (const row of readContactUploadCsv(source, MAPPING)) {
        void row
      }
    })()
    source.destroy(new Error('socket hang up'))

    await expect(reading).rejects.toThrow('socket hang up')
  })
})

describe('normalizePhone', () => {
  it.each([
    ['616-555-0142', '(616) 555-0142'],
    ['+1 (616) 555 0142', '(616) 555-0142'],
    ['555-0142', null],
    ['(116) 555-0142', null],
    ['616-055-0142', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })
})

describe('normalizeZip', () => {
  it.each([
    ['49503', '49503'],
    ['49503-1234', '49503'],
    ['2134', '02134'],
    ['49', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeZip(input)).toBe(expected)
  })
})
