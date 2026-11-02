import {
  CONTACT_UPLOAD_FIELDS,
  type ContactUploadColumnMapping,
  type ContactUploadField,
} from '@goodparty_org/contracts'

export interface CsvPreview {
  headers: string[]
  examples: Record<string, string>
  rowCount: number
}

// The wizard reads the file in the browser only to name its columns, show an
// example of each and count its people. gp-api parses it again on upload.
export const parseCsvPreview = (text: string): CsvPreview => {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')

  const endRecord = () => {
    record.push(field)
    if (record.some((value) => value.trim() !== '')) records.push(record)
    record = []
    field = ''
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      endRecord()
    } else {
      field += char
    }
  }
  if (field !== '' || record.length > 0) endRecord()

  const [headerRow = [], ...dataRows] = records
  const headers = headerRow.map((header) => header.trim())
  const examples: Record<string, string> = {}
  headers.forEach((header, index) => {
    if (!header || examples[header] !== undefined) return
    const example = dataRows
      .slice(0, 50)
      .map((row) => row[index]?.trim() ?? '')
      .find((value) => value !== '')
    examples[header] = example ?? ''
  })

  return {
    headers: headers.filter(
      (header, index) => header !== '' && headers.indexOf(header) === index,
    ),
    examples,
    rowCount: dataRows.length,
  }
}

export type ColumnMappingDraft = Record<ContactUploadField, string | null>

const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, '')

const HEADER_ALIASES: Record<ContactUploadField, string[]> = {
  firstName: ['firstname', 'first', 'fname', 'givenname'],
  lastName: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'mail'],
  cellPhone: [
    'cellphone',
    'cell',
    'mobile',
    'mobilephone',
    'cellphonenumber',
    'mobilenumber',
    'phone',
    'phonenumber',
  ],
  landline: ['landline', 'homephone', 'home', 'landlinephone', 'telephone'],
  addressLine: [
    'address',
    'addressline',
    'addressline1',
    'address1',
    'street',
    'streetaddress',
  ],
  city: ['city', 'town'],
  zip: ['zip', 'zipcode', 'postalcode', 'postcode'],
}

export const emptyColumnMapping = (): ColumnMappingDraft => ({
  firstName: null,
  lastName: null,
  email: null,
  cellPhone: null,
  landline: null,
  addressLine: null,
  city: null,
  zip: null,
})

// The latest upload's choices win when every column it used is in this file
// too, so a monthly re-upload of the same spreadsheet needs no matching.
// Otherwise each field takes the first unused column whose name is a known
// way of writing it ("Mobile" for cell phone, "Surname" for last name).
export const prefillColumnMapping = (
  headers: string[],
  latest: ContactUploadColumnMapping | null,
): ColumnMappingDraft => {
  if (latest) {
    const used = CONTACT_UPLOAD_FIELDS.map((field) => latest[field]).filter(
      (header): header is string => header !== null,
    )
    if (used.every((header) => headers.includes(header))) {
      return { ...emptyColumnMapping(), ...latest }
    }
  }

  const mapping = emptyColumnMapping()
  const taken = new Set<string>()
  CONTACT_UPLOAD_FIELDS.forEach((field) => {
    const match = headers.find(
      (header) =>
        !taken.has(header) &&
        HEADER_ALIASES[field].includes(normalizeHeader(header)),
    )
    if (match) {
      mapping[field] = match
      taken.add(match)
    }
  })
  return mapping
}
