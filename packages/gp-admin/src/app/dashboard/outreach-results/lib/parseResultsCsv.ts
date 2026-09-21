import {
  OutreachResultsUploadRowSchema,
  type OutreachResultsUploadRow,
} from '@goodparty_org/contracts'

// Fulfilment returns one CSV per send, produced by whatever tool they used to
// do the texting. The header spellings below are the ones the serve analysis
// pipeline already accepts (`packages/gp-ai/serve/v1_pipeline`), so a human
// who has been returning poll results for a year does not learn a second
// format to return SMS results.
//
// Parsing happens here, in the browser, purely so the operator hears about a
// wrong file before a round trip: wrong columns, zero rows, a column of blank
// phones. It is a preflight, not the authority. The counts that matter
// (matched / unmatched / opt-outs) need the recipient map and the single
// server-side opt-out predicate, so they come back from the dry run, and the
// raw file text is what gets uploaded — a poll's file has to reach S3 byte for
// byte, exactly as fulfilment produced it.

export type ResultsCsvField = 'phone' | 'content' | 'receivedAt'

// Compared after `normalizeHeader`, which lowercases and folds underscores
// and runs of whitespace into single spaces. That one fold is what makes
// `phone_number` and `Contact Phone Number` the same column.
const HEADER_ALIASES: Record<ResultsCsvField, string[]> = {
  phone: ['phone', 'phone number', 'contact phone number'],
  content: ['content', 'message', 'message text'],
  receivedAt: ['received at', 'sent at'],
}

export const REQUIRED_FIELDS: ResultsCsvField[] = ['phone', 'content']

export const ACCEPTED_HEADERS: Record<ResultsCsvField, string> = {
  phone: 'phone_number or Contact Phone Number',
  content: 'message_text or Message Text',
  receivedAt: 'sent_at or Sent At (optional)',
}

export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .replace(/["']/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
}

/** The header as fulfilment spelled it, per field we recognized. */
export type ResultsCsvColumnMap = {
  [K in ResultsCsvField]: K extends 'receivedAt' ? string | null : string
}

export interface SkippedResultsRow {
  /** 1-based line in the file, counting the header, so it matches a spreadsheet. */
  line: number
  reason: string
}

export type ParsedResultsCsv =
  | {
      ok: true
      columns: ResultsCsvColumnMap
      rows: OutreachResultsUploadRow[]
      skipped: SkippedResultsRow[]
      /** Non-empty data lines found, whether or not they survived validation. */
      dataRows: number
    }
  | { ok: false; error: string }

export interface CsvReadResult {
  rows: string[][]
  // The file ended with a quote still open, which means it is not a whole
  // CSV — a download cut short, a copy-paste that dropped the tail. The
  // bytes that are there parse fine, which is the danger: without this flag
  // a truncated file reads as a shorter valid one.
  unterminatedQuote: boolean
}

// A hand-rolled reader rather than a dependency: the whole grammar is quotes,
// doubled quotes and newlines, and a reply body routinely contains all three.
// Splitting on commas would silently truncate exactly the messages people
// wrote the most in.
export function parseCsvRows(text: string): CsvReadResult {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
      i += 1
      continue
    }
    if (char === ',') {
      endField()
      i += 1
      continue
    }
    if (char === '\r') {
      // Swallow CRLF as one terminator; a lone CR also ends the row.
      endRow()
      i += text[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (char === '\n') {
      endRow()
      i += 1
      continue
    }
    field += char
    i += 1
  }

  if (field !== '' || row.length > 0) endRow()
  return { rows, unterminatedQuote: quoted }
}

const isBlankRow = (cells: string[]) =>
  cells.every((cell) => cell.trim() === '')

export function parseResultsCsv(text: string): ParsedResultsCsv {
  const { rows, unterminatedQuote } = parseCsvRows(text)

  // Refuse before reading a single row. A truncated file parses cleanly up to
  // the cut, so every count below it would be a confident undercount, and the
  // raw bytes are what gets uploaded — the operator would be shown a plausible
  // report for a file that is missing its tail.
  if (unterminatedQuote) {
    return {
      ok: false,
      error:
        'That file ends in the middle of a quoted value, so it is incomplete — ' +
        'the export or download was cut short. Get a whole copy and try again.',
    }
  }

  const headerRow = rows.find((cells) => !isBlankRow(cells))
  if (!headerRow) {
    return { ok: false, error: 'That file is empty.' }
  }
  const headerIndex = rows.indexOf(headerRow)

  const headers = headerRow.map(normalizeHeader)
  const indexOfField = (field: ResultsCsvField): number =>
    headers.findIndex((header) => HEADER_ALIASES[field].includes(header))

  const phoneIndex = indexOfField('phone')
  const contentIndex = indexOfField('content')
  const receivedAtIndex = indexOfField('receivedAt')

  const missing = REQUIRED_FIELDS.filter((field) =>
    field === 'phone' ? phoneIndex === -1 : contentIndex === -1
  )
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing
        .map((field) => ACCEPTED_HEADERS[field])
        .join(', ')}. Found: ${headerRow.join(', ') || '(no header row)'}`,
    }
  }

  const columns: ResultsCsvColumnMap = {
    phone: headerRow[phoneIndex].trim(),
    content: headerRow[contentIndex].trim(),
    receivedAt:
      receivedAtIndex === -1 ? null : headerRow[receivedAtIndex].trim(),
  }

  const parsedRows: OutreachResultsUploadRow[] = []
  const skipped: SkippedResultsRow[] = []
  let dataRows = 0

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index]
    if (isBlankRow(cells)) continue
    dataRows += 1
    const line = index + 1

    const rawReceivedAt =
      receivedAtIndex === -1 ? '' : (cells[receivedAtIndex] ?? '').trim()

    const candidate = {
      phone: (cells[phoneIndex] ?? '').trim(),
      content: cells[contentIndex] ?? '',
      // An empty cell is "no timestamp", not "an invalid timestamp": the
      // server defaults it to upload time. Coercing '' would make a whole
      // optional column fail validation.
      ...(rawReceivedAt === '' ? {} : { receivedAt: rawReceivedAt }),
    }

    const result = OutreachResultsUploadRowSchema.safeParse(candidate)
    if (!result.success) {
      skipped.push({
        line,
        reason:
          candidate.phone === ''
            ? 'no phone number'
            : (result.error.issues[0]?.message ?? 'could not be read'),
      })
      continue
    }
    parsedRows.push(result.data)
  }

  return { ok: true, columns, rows: parsedRows, skipped, dataRows }
}
