import { describe, expect, it } from 'vitest'
import type { ContactUploadColumnMapping } from '@goodparty_org/contracts'
import { parseCsvPreview, prefillColumnMapping } from './importContactsCsv'

describe('parseCsvPreview', () => {
  it('reads the headers, an example per column and the row count', () => {
    const preview = parseCsvPreview(
      '\uFEFFFirst name,Last name,Email\r\nMaria,Lopez,maria@example.com\r\nDana,Whitfield,\r\n',
    )

    expect(preview.headers).toEqual(['First name', 'Last name', 'Email'])
    expect(preview.examples).toEqual({
      'First name': 'Maria',
      'Last name': 'Lopez',
      Email: 'maria@example.com',
    })
    expect(preview.rowCount).toBe(2)
  })

  it('keeps quoted commas, quotes and line breaks inside one value', () => {
    const preview = parseCsvPreview(
      'Name,Address\n"Lopez, Maria","14 ""Oak"" St\nApt 2"\n',
    )

    expect(preview.examples).toEqual({
      Name: 'Lopez, Maria',
      Address: '14 "Oak" St\nApt 2',
    })
    expect(preview.rowCount).toBe(1)
  })

  it('skips blank lines and takes the first non-empty example', () => {
    const preview = parseCsvPreview('Email\n\n,\n\nlater@example.com\n')

    expect(preview.examples).toEqual({ Email: 'later@example.com' })
    expect(preview.rowCount).toBe(1)
  })

  it('counts no rows for a header-only file', () => {
    expect(parseCsvPreview('First name,Last name\n').rowCount).toBe(0)
  })
})

describe('prefillColumnMapping', () => {
  const latest: ContactUploadColumnMapping = {
    firstName: 'Given',
    lastName: 'Family',
    email: 'E-mail',
    cellPhone: null,
    landline: null,
    addressLine: null,
    city: null,
    zip: null,
  }

  it("reuses the latest upload's choices when every column it used is here", () => {
    expect(
      prefillColumnMapping(['Given', 'Family', 'E-mail', 'Mobile'], latest),
    ).toEqual(latest)
  })

  it('falls back to header names when the latest choices do not fit', () => {
    expect(
      prefillColumnMapping(
        [
          'First Name',
          'Surname',
          'Email Address',
          'Mobile',
          'Home phone',
          'Street Address',
          'City',
          'ZIP code',
          'Heard about me',
        ],
        latest,
      ),
    ).toEqual({
      firstName: 'First Name',
      lastName: 'Surname',
      email: 'Email Address',
      cellPhone: 'Mobile',
      landline: 'Home phone',
      addressLine: 'Street Address',
      city: 'City',
      zip: 'ZIP code',
    })
  })

  it('leaves a field unmapped when no column looks like it', () => {
    const mapping = prefillColumnMapping(['Name', 'Notes'], null)

    expect(mapping.firstName).toBeNull()
    expect(mapping.lastName).toBeNull()
  })
})
