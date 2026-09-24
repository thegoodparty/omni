import { MAX_RESULTS_FILE_BYTES } from '../types'
import { parseResultsCsv, type ParsedResultsCsv } from './parseResultsCsv'

// The one definition of "this file can be uploaded".
//
// It runs in two places, and only one of them is a guarantee. In the browser
// it is fast feedback: the operator hears about a wrong or truncated file
// before a round trip. **On the server it is the boundary** — a server action
// is a public POST endpoint, so an org:admin with a script or a replayed
// request reaches `commitResultsUpload` without ever loading the page. That
// matters most for a poll, whose bytes are written to S3 exactly as received:
// a check that only ever ran in a browser would not have stopped the
// truncated-CSV corruption it was written to stop.
//
// Both callers go through this module rather than repeating the rules, so
// the two cannot drift into disagreeing about what a good file is.

export const EMPTY_NAME_MESSAGE = 'That file has no name.'

export const TOO_LARGE_MESSAGE =
  'That file is larger than 5MB. Check it is the results CSV.'

export const NO_USABLE_ROWS_MESSAGE =
  'No usable rows in that file. Nothing to upload.'

export interface ResultsFileInput {
  fileName: string
  csv: string
}

// Returns the parse so the page can show what it read; returns a refusal for
// anything wrong at the file level before parsing is even worth attempting.
export function checkResultsFile({
  fileName,
  csv,
}: ResultsFileInput): ParsedResultsCsv {
  if (!fileName.trim()) return { ok: false, error: EMPTY_NAME_MESSAGE }
  if (!csv.trim()) return { ok: false, error: 'That file is empty.' }
  // Byte length, not character count: a UTF-8 reply body is routinely wider
  // than one byte per character.
  if (new TextEncoder().encode(csv).length > MAX_RESULTS_FILE_BYTES) {
    return { ok: false, error: TOO_LARGE_MESSAGE }
  }
  return parseResultsCsv(csv)
}

// Why this file cannot be uploaded, or null if it can. Separate from the
// check itself so the page can show the detail of a parse that succeeded but
// yielded nothing usable, instead of replacing it with a bare refusal.
export function uploadBlocker(result: ParsedResultsCsv): string | null {
  if (!result.ok) return result.error
  if (result.rows.length === 0) return NO_USABLE_ROWS_MESSAGE
  return null
}
