import csvParser from 'csv-parser'
import { Readable } from 'stream'
import {
  CONTACT_UPLOAD_MAX_ROWS,
  EmailSchema,
  type ContactUploadColumnMapping,
} from '@goodparty_org/contracts'

export class ContactUploadFileError extends Error {}

export type ParsedContactUploadRow = {
  rowIndex: number
  firstName: string | null
  lastName: string | null
  email: string | null
  cellPhone: string | null
  landline: string | null
  addressLine: string | null
  city: string | null
  zip: string | null
  hasName: boolean
}

const normalizeHeader = (header: string): string =>
  header.replace(/^\uFEFF/, '').trim()

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export const normalizeEmail = (value: string | null): string | null => {
  if (value === null) return null
  const lowered = value.toLowerCase()
  return EmailSchema.safeParse(lowered).success ? lowered : null
}

// The L2 format every outreach channel already reads. NANP area codes and
// exchanges never start with 0 or 1.
export const normalizePhone = (value: string | null): string | null => {
  if (value === null) return null
  const digits = value.replace(/\D/g, '')
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(local)) return null
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
}

// Excel drops a ZIP's leading zeros, so a 3 or 4 digit value is padded back.
export const normalizeZip = (value: string | null): string | null => {
  if (value === null) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 5 || digits.length === 9) return digits.slice(0, 5)
  if (digits.length === 3 || digits.length === 4) {
    return digits.padStart(5, '0')
  }
  return null
}

// Row budget for the parser: a stray quote that never closes would otherwise
// read the rest of the file as one value.
const MAX_ROW_BYTES = 64 * 1024

// Reads an upload's file one row at a time. Throws ContactUploadFileError,
// whose message is shown to the user, for a file that can never import; an
// error from the source stream itself is rethrown as is.
export async function* readContactUploadCsv(
  source: Readable,
  mapping: ContactUploadColumnMapping,
): AsyncGenerator<ParsedContactUploadRow> {
  let headers: string[] = []
  let sourceError: Error | null = null
  const parser = csvParser({
    mapHeaders: ({ header }) => normalizeHeader(header),
    maxRowBytes: MAX_ROW_BYTES,
  })
  parser.on('headers', (parsed: string[]) => {
    headers = parsed
  })
  source.on('error', (err) => {
    sourceError = err
    parser.destroy(err)
  })
  source.pipe(parser)

  const column = (header: string | null): string | null =>
    header === null ? null : normalizeHeader(header)
  const columns = {
    firstName: column(mapping.firstName),
    lastName: column(mapping.lastName),
    email: column(mapping.email),
    cellPhone: column(mapping.cellPhone),
    landline: column(mapping.landline),
    addressLine: column(mapping.addressLine),
    city: column(mapping.city),
    zip: column(mapping.zip),
  }
  const assertMappedColumns = () => {
    const missing = Object.values(columns).filter(
      (header): header is string =>
        header !== null && !headers.includes(header),
    )
    if (missing.length > 0) {
      throw new ContactUploadFileError(
        `This file has no column named ${missing.map((h) => `"${h}"`).join(', ')}. Import it again and pick columns it has.`,
      )
    }
  }

  let rowIndex = 0
  try {
    const records: AsyncIterable<Record<string, string>> = parser
    for await (const record of records) {
      if (rowIndex === 0) assertMappedColumns()
      if (rowIndex >= CONTACT_UPLOAD_MAX_ROWS) {
        throw new ContactUploadFileError(
          `This file has more than ${CONTACT_UPLOAD_MAX_ROWS.toLocaleString('en-US')} people. Split it into smaller files and import each one.`,
        )
      }
      const read = (header: string | null): string | null =>
        header === null ? null : blankToNull(record[header])
      const firstName = read(columns.firstName)
      const lastName = read(columns.lastName)
      yield {
        rowIndex,
        firstName,
        lastName,
        email: normalizeEmail(read(columns.email)),
        cellPhone: normalizePhone(read(columns.cellPhone)),
        landline: normalizePhone(read(columns.landline)),
        addressLine: read(columns.addressLine),
        city: read(columns.city),
        zip: normalizeZip(read(columns.zip)),
        hasName: firstName !== null && lastName !== null,
      }
      rowIndex++
    }
  } catch (err) {
    if (err instanceof ContactUploadFileError || err === sourceError) throw err
    throw new ContactUploadFileError(
      "We couldn't read this file. Save it as a CSV and import it again.",
    )
  } finally {
    parser.destroy()
    source.destroy()
  }

  if (rowIndex === 0) {
    assertMappedColumns()
    throw new ContactUploadFileError(
      'This file has no people in it. Add them and import it again.',
    )
  }
}
