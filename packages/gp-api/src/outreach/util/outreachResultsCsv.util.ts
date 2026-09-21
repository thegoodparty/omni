import {
  OutreachResultsUploadRowSchema,
  type OutreachResultsUploadRow,
} from '@goodparty_org/contracts'

/**
 * Fulfilment returns one CSV per send, produced by whatever tool they used to
 * do the texting. The header spellings below are the ones the serve analysis
 * pipeline already accepts (`packages/gp-ai/serve/v1_pipeline`), so a human
 * who has been returning poll results for a year does not learn a second
 * format to return SMS results.
 *
 * This is deliberately a SECOND copy of the rules gp-admin applies in
 * `lib/parseResultsCsv.ts`. gp-admin's server action is the authority for
 * gp-admin; it is not the authority for gp-api. This endpoint is
 * AdminOrM2M-gated, so an M2M token or a replayed request reaches it without
 * ever passing through a Next.js action, and it is the only thing standing
 * between a truncated file and rows written against real constituents.
 *
 * The two copies must agree on what a good file is — if you change an
 * accepted header here, change it there. They are kept honest by the fact
 * that a disagreement is visible immediately: the page shows a preflight
 * count and the server's dry run comes straight back with its own.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery", Inbound.
 */

export type ResultsCsvField = 'phone' | 'content' | 'receivedAt'

// Compared after `normalizeResultsHeader`, which lowercases and folds
// underscores and runs of whitespace into single spaces. That one fold is
// what makes `phone_number` and `Contact Phone Number` the same column.
const HEADER_ALIASES: Record<ResultsCsvField, string[]> = {
  phone: ['phone', 'phone number', 'contact phone number'],
  content: ['content', 'message', 'message text'],
  receivedAt: ['received at', 'sent at'],
}

const ACCEPTED_HEADERS: Record<ResultsCsvField, string> = {
  phone: 'phone_number or Contact Phone Number',
  content: 'message_text or Message Text',
  receivedAt: 'sent_at or Sent At (optional)',
}

/**
 * Byte length, not character count: a UTF-8 reply body is routinely wider
 * than one byte per character. Matches MAX_RESULTS_FILE_BYTES in gp-admin,
 * which is in turn pinned to that app's server-action body limit. This copy
 * exists because a caller that never went through gp-admin is exactly the
 * caller this endpoint has to survive.
 */
export const MAX_RESULTS_CSV_BYTES = 5 * 1024 * 1024

export const EMPTY_NAME_MESSAGE = 'That file has no name.'
export const EMPTY_FILE_MESSAGE = 'That file is empty.'
export const TOO_LARGE_MESSAGE =
  'That file is larger than 5MB. Check it is the results CSV.'
export const NO_USABLE_ROWS_MESSAGE =
  'No usable rows in that file. Nothing to upload.'
export const TRUNCATED_MESSAGE =
  'That file ends in the middle of a quoted value, so it is incomplete — ' +
  'the export or download was cut short. Get a whole copy and try again.'

export function normalizeResultsHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .replace(/["']/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
}

export interface SkippedResultsRow {
  /** 1-based line in the file, counting the header, so it matches a spreadsheet. */
  line: number
  reason: string
}

export type ParsedResultsCsv =
  | {
      ok: true
      rows: OutreachResultsUploadRow[]
      skipped: SkippedResultsRow[]
    }
  | { ok: false; error: string }

interface CsvReadResult {
  rows: string[][]
  // The file ended with a quote still open, which means it is not a whole
  // CSV — a download cut short, a copy-paste that dropped the tail. The
  // bytes that are there parse fine, which is the danger: without this flag
  // a truncated file reads as a shorter valid one.
  unterminatedQuote: boolean
}

// A hand-rolled reader rather than the repo's neat-csv: the whole grammar is
// quotes, doubled quotes and newlines, and the one thing that matters most
// here — "did this file end mid-value" — is exactly what a streaming parser
// swallows. A reply body routinely contains commas, quotes and newlines, so
// splitting on commas would silently truncate the messages people wrote the
// most in.
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

/**
 * Everything wrong with the file itself, before a single row is read. The
 * name and the size are checked here rather than in the schema because the
 * sentence a human gets back should say which of the three it was.
 */
export function checkResultsCsv(input: {
  fileName: string
  csv: string
}): ParsedResultsCsv {
  if (!input.fileName.trim()) return { ok: false, error: EMPTY_NAME_MESSAGE }
  if (!input.csv.trim()) return { ok: false, error: EMPTY_FILE_MESSAGE }
  if (Buffer.byteLength(input.csv, 'utf8') > MAX_RESULTS_CSV_BYTES) {
    return { ok: false, error: TOO_LARGE_MESSAGE }
  }
  return parseResultsCsv(input.csv)
}

export function parseResultsCsv(text: string): ParsedResultsCsv {
  const { rows, unterminatedQuote } = parseCsvRows(text)

  // Refuse before reading a single row. A truncated file parses cleanly up to
  // the cut, so every count below it would be a confident undercount and the
  // operator would be shown a plausible report for a file missing its tail.
  if (unterminatedQuote) return { ok: false, error: TRUNCATED_MESSAGE }

  const headerRow = rows.find((cells) => !isBlankRow(cells))
  if (!headerRow) return { ok: false, error: EMPTY_FILE_MESSAGE }
  const headerIndex = rows.indexOf(headerRow)

  const headers = headerRow.map(normalizeResultsHeader)
  const indexOfField = (field: ResultsCsvField): number =>
    headers.findIndex((header) => HEADER_ALIASES[field].includes(header))

  const phoneIndex = indexOfField('phone')
  const contentIndex = indexOfField('content')
  const receivedAtIndex = indexOfField('receivedAt')

  const missing: ResultsCsvField[] = []
  if (phoneIndex === -1) missing.push('phone')
  if (contentIndex === -1) missing.push('content')
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing
        .map((field) => ACCEPTED_HEADERS[field])
        .join(', ')}. Found: ${headerRow.join(', ') || '(no header row)'}`,
    }
  }

  const parsedRows: OutreachResultsUploadRow[] = []
  const skipped: SkippedResultsRow[] = []

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index]
    if (!cells || isBlankRow(cells)) continue
    const line = index + 1

    const rawReceivedAt =
      receivedAtIndex === -1 ? '' : (cells[receivedAtIndex] ?? '').trim()

    const candidate = {
      phone: (cells[phoneIndex] ?? '').trim(),
      content: cells[contentIndex] ?? '',
      // An empty cell is "no timestamp", not "an invalid timestamp": the
      // ingest defaults it to write time. Coercing '' would make a whole
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

  return { ok: true, rows: parsedRows, skipped }
}
