import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type { ContactUploadColumnMapping } from '@goodparty_org/contracts'
import {
  normalizePhone,
  normalizeZip,
  parseContactUploadCsv,
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

const parse = (csv: string, mapping = MAPPING) =>
  parseContactUploadCsv(Buffer.from(csv), mapping)

describe('parseContactUploadCsv', () => {
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

  it('400s when a mapped header is missing', async () => {
    await expect(
      parse('First,Last,Email,Mobile,Street\nJane,Doe,,,\n'),
    ).rejects.toThrow(BadRequestException)
  })

  it('400s on a header row only', async () => {
    await expect(parse('First,Last,Email,Mobile,Street,Zip\n')).rejects.toThrow(
      BadRequestException,
    )
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
